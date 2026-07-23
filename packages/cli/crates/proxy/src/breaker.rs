use dashmap::DashMap;
use std::time::{Duration, Instant};

use crate::{FAILURE_THRESHOLD, RECOVERY_TIMEOUT_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakerStatus {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy)]
struct BreakerState {
    consecutive_failures: u32,
    opened_at: Option<Instant>,
}

impl BreakerState {
    fn status(&self, recovery: Duration) -> BreakerStatus {
        match self.opened_at {
            None => BreakerStatus::Closed,
            Some(t) if t.elapsed() >= recovery => BreakerStatus::HalfOpen,
            Some(_) => BreakerStatus::Open,
        }
    }
}

/// 惰性时间戳熔断器：无定时任务，状态迁移在调用时判定（决策点 1）。
pub struct CircuitBreaker {
    threshold: u32,
    recovery: Duration,
    states: DashMap<String, BreakerState>,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        Self::with_config(
            FAILURE_THRESHOLD,
            Duration::from_millis(RECOVERY_TIMEOUT_MS),
        )
    }

    pub fn with_config(threshold: u32, recovery: Duration) -> Self {
        Self {
            threshold,
            recovery,
            states: DashMap::new(),
        }
    }

    pub fn status(&self, profile_id: &str) -> BreakerStatus {
        self.states
            .get(profile_id)
            .map(|s| s.status(self.recovery))
            .unwrap_or(BreakerStatus::Closed)
    }

    pub fn is_available(&self, profile_id: &str) -> bool {
        !matches!(self.status(profile_id), BreakerStatus::Open)
    }

    pub fn record_success(&self, profile_id: &str) {
        self.states.remove(profile_id); // 完全复位
    }

    pub fn record_failure(&self, profile_id: &str) {
        let mut entry = self
            .states
            .entry(profile_id.to_string())
            .or_insert(BreakerState {
                consecutive_failures: 0,
                opened_at: None,
            });
        match entry.status(self.recovery) {
            BreakerStatus::HalfOpen => {
                // half_open 失败 → 回 open 重计时
                entry.opened_at = Some(Instant::now());
            }
            BreakerStatus::Open => {
                // open 期间不应有请求到达（is_available 已拦截）；防御性重计时
                entry.opened_at = Some(Instant::now());
            }
            BreakerStatus::Closed => {
                entry.consecutive_failures += 1;
                if entry.consecutive_failures >= self.threshold {
                    entry.opened_at = Some(Instant::now());
                }
            }
        }
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new()
    }
}

// 注意：half_open 期间并发请求会同时放行（TS 也是如此：`isAvailable` 只看 `isOpen`），
// 不做单飞限制，与 TS 对齐。

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    fn breaker() -> CircuitBreaker {
        CircuitBreaker::with_config(3, Duration::from_millis(50))
    }

    #[test]
    fn opens_after_threshold_failures() {
        let b = breaker();
        assert!(b.is_available("p1"));
        b.record_failure("p1");
        b.record_failure("p1");
        assert!(b.is_available("p1")); // 2 < 3
        b.record_failure("p1");
        assert!(!b.is_available("p1"));
        assert_eq!(b.status("p1"), BreakerStatus::Open);
        // 独立 profileId 不受影响
        assert!(b.is_available("p2"));
    }

    #[test]
    fn lazy_half_open_after_recovery() {
        let b = breaker();
        for _ in 0..3 {
            b.record_failure("p1");
        }
        assert!(!b.is_available("p1"));
        sleep(Duration::from_millis(60));
        assert!(b.is_available("p1")); // 惰性 half_open 放行
        assert_eq!(b.status("p1"), BreakerStatus::HalfOpen);
    }

    #[test]
    fn half_open_failure_reopens_and_retarts_timer() {
        let b = breaker();
        for _ in 0..3 {
            b.record_failure("p1");
        }
        sleep(Duration::from_millis(60));
        assert!(b.is_available("p1"));
        b.record_failure("p1"); // half_open 失败 → 回 open
        assert!(!b.is_available("p1"));
    }

    #[test]
    fn success_fully_resets() {
        let b = breaker();
        for _ in 0..3 {
            b.record_failure("p1");
        }
        sleep(Duration::from_millis(60));
        b.record_success("p1");
        assert_eq!(b.status("p1"), BreakerStatus::Closed);
        b.record_failure("p1");
        assert!(b.is_available("p1")); // 重新从 0 计数
    }
}
