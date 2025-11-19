import type { ClaudeCodeProfile } from "../types.js";

/**
 * Coder 配置适配器接口
 */
export interface CoderAdapter {
  /**
   * Coder 名称
   */
  name: string;

  /**
   * 配置文件路径
   */
  configPath: string;

  /**
   * 应用配置到 coder
   * @param profile Swixter profile 配置
   */
  apply(profile: ClaudeCodeProfile): Promise<void>;

  /**
   * 验证配置是否已正确应用
   * @param profile Swixter profile 配置
   */
  verify(profile: ClaudeCodeProfile): Promise<boolean>;
}
