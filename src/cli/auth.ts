/**
 * Auth CLI commands
 * swixter auth register | login | logout | status | delete-account
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import * as readline from "node:readline";
import type { AuthApiResponse } from "../auth/types.js";
import { registerUser, loginUser, logoutUser, deleteAccount, sendMagicLink, verifyMagicLink, checkMagicLinkSession, setPassword } from "../auth/client.js";
import { loadAuthState, saveAuthState, clearAuthState, isLoggedIn, getAccessToken } from "../auth/token.js";
import { deriveKey, exportKeyToBase64 } from "../crypto/derive.js";
import { clearSyncMeta } from "../config/manager.js";

const MAGIC_LINK_POLL_INTERVAL_MS = 2000;
const MAGIC_LINK_MAX_ATTEMPTS = 300; // 10 minutes at 2s interval

/**
 * Interactive registration
 */
async function cmdRegister(): Promise<void> {
  p.intro(pc.bold(pc.cyan("Register Swixter Account")));

  const email = await p.text({
    message: "Email:",
    validate: (v) => {
      if (!v) return "Email is required";
      if (!v.includes("@")) return "Invalid email format";
    },
  });
  if (p.isCancel(email)) return;

  const password = await p.password({
    message: "Password:",
    validate: (v) => {
      if (!v) return "Password is required";
      if (v.length < 6) return "Password must be at least 6 characters";
    },
  });
  if (p.isCancel(password)) return;

  const displayName = await p.text({
    message: "Display name (optional):",
  });
  if (p.isCancel(displayName)) return;

  const s = p.spinner();
  s.start("Creating account...");

  try {
    const result = await registerUser({
      email: email as string,
      password: password as string,
      displayName: displayName as string | undefined,
    });

    await persistAuth(result);
    s.stop(pc.green("✓ Account created and logged in!"));

    // Set up encryption
    const state = await loadAuthState();
    await setupEncryptionAfterAuth(state);

    p.outro(`Welcome, ${pc.cyan(result.user.displayName || result.user.email)}!`);
  } catch (err: any) {
    s.stop(pc.red("✗ Registration failed"));
    console.error(pc.red(err.message || "Unknown error"));
    process.exit(1);
  }
}

/**
 * Interactive login
 */
async function cmdLogin(): Promise<void> {
  p.intro(pc.bold(pc.cyan("Login to Swixter")));

  const email = await p.text({
    message: "Email:",
    validate: (v) => {
      if (!v) return "Email is required";
      if (!v.includes("@")) return "Invalid email format";
    },
  });
  if (p.isCancel(email)) return;

  const password = await p.password({
    message: "Password:",
    validate: (v) => {
      if (!v) return "Password is required";
    },
  });
  if (p.isCancel(password)) return;

  const s = p.spinner();
  s.start("Logging in...");

  try {
    const result = await loginUser({
      email: email as string,
      password: password as string,
    });

    const userChanged = await persistAuth(result);
    s.stop(pc.green("✓ Logged in successfully!"));

    // Set up encryption if not already configured
    const state = await loadAuthState();
    if (state && !state.encryptionKey) {
      await setupEncryptionAfterAuth(state);
    }

    // If a different user logged in, ask about cloud data
    if (userChanged) {
      await promptSyncChoice(state);
      return;
    }

    p.outro(`Welcome back, ${pc.cyan(result.user.displayName || result.user.email)}!`);
  } catch (err: any) {
    s.stop(pc.red("✗ Login failed"));
    console.error(pc.red(err.message || "Invalid email or password"));
    process.exit(1);
  }
}

/**
 * Logout
 */
async function cmdLogout(): Promise<void> {
  const state = await loadAuthState();
  if (state) {
    try {
      await logoutUser(state.refreshToken);
    } catch {
      // Ignore — server may already have revoked it
    }
  }

  await clearAuthState();
  await clearSyncMeta();
  console.log(pc.green("✓ Logged out"));
}

/**
 * Show login status
 */
async function cmdStatus(): Promise<void> {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    console.log(pc.yellow("Not logged in"));
    console.log(pc.dim("Run 'swixter auth login' to sign in"));
    return;
  }

  const state = await loadAuthState();
  if (state) {
    console.log(pc.green("✓ Logged in"));
    console.log(`  Email: ${pc.cyan(state.email)}`);
    console.log(`  User ID: ${pc.dim(state.userId)}`);
    console.log(`  Expires: ${pc.dim(state.expiresAt)}`);
  }
}

/**
 * Delete account
 */
async function cmdDeleteAccount(): Promise<void> {
  const state = await loadAuthState();
  if (!state) {
    console.log(pc.yellow("Not logged in"));
    return;
  }

  const confirmed = await p.confirm({
    message: pc.red("This will permanently delete your cloud account and all synced data. Continue?"),
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    console.log(pc.dim("Cancelled"));
    return;
  }

  const s = p.spinner();
  s.start("Deleting account...");

  try {
    const token = await getAccessToken();
    if (!token) {
      s.stop(pc.red("Session expired. Please log in again."));
      process.exit(1);
    }
    await deleteAccount(token);
    await clearAuthState();
    await clearSyncMeta();
    s.stop(pc.green("✓ Account deleted"));
  } catch (err: any) {
    s.stop(pc.red("✗ Failed to delete account"));
    console.error(pc.red(err.message || "Unknown error"));
    process.exit(1);
  }
}

/**
 * Persist auth response to local state.
 * If the user email changed, clear syncMeta so the new user
 * starts with a clean sync state.
 * Returns true if the user changed.
 */
async function persistAuth(result: AuthApiResponse): Promise<boolean> {
  const previousState = await loadAuthState();
  const userChanged = previousState != null && previousState.email !== result.user.email;

  await saveAuthState({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    encryptionSalt: result.encryptionSalt,
    authMethod: "password",
    userId: result.user.id,
    email: result.user.email,
  });

  if (userChanged) {
    await clearSyncMeta();
  }

  return userChanged;
}

/**
 * Prompt user to set up end-to-end encryption after login/register
 */
async function setupEncryptionAfterAuth(state: Awaited<ReturnType<typeof loadAuthState>>): Promise<void> {
  if (!state) return;

  const setupEncryption = await p.confirm({
    message: "Set up end-to-end encryption for cloud sync?",
    initialValue: true,
  });

  if (p.isCancel(setupEncryption) || !setupEncryption) {
    return;
  }

  const masterPassword = await p.password({
    message: "Create master password for encryption (separate from login password):",
    validate: (v) => {
      if (!v) return "Master password is required";
      if (v.length < 8) return "Must be at least 8 characters";
    },
  });
  if (p.isCancel(masterPassword)) return;

  const key = await deriveKey(masterPassword as string, state.encryptionSalt);
  const keyBase64 = await exportKeyToBase64(key);

  const remember = await p.confirm({
    message: "Save encryption key locally for automatic sync? (Less secure but convenient)",
    initialValue: false,
  });

  if (!p.isCancel(remember) && remember) {
    state.encryptionKey = keyBase64;
    await saveAuthState(state);
    console.log(pc.dim("Encryption key saved for automatic sync"));
  }
}

/**
 * When a different user logs in, ask whether to pull their cloud data,
 * push local data, or do nothing.
 */
async function promptSyncChoice(state: Awaited<ReturnType<typeof loadAuthState>>): Promise<void> {
  if (!state?.encryptionKey) {
    console.log(pc.dim("Cloud sync requires an encryption key. Run 'swixter sync push' after setting one up."));
    return;
  }

  const choice = await p.select({
    message: "Different account detected. How would you like to handle cloud data?",
    options: [
      { value: "pull", label: "Pull from cloud", hint: "Replace local profiles with cloud data" },
      { value: "push", label: "Push to cloud", hint: "Upload local profiles to this account" },
      { value: "skip", label: "Skip for now", hint: "No sync action" },
    ],
  });

  if (p.isCancel(choice)) return;

  if (choice === "pull") {
    const { handleSyncCommand } = await import("./sync.js");
    await handleSyncCommand(["pull", "--force-remote"]);
  } else if (choice === "push") {
    const { handleSyncCommand } = await import("./sync.js");
    await handleSyncCommand(["push", "--force-local"]);
  }
}

/**
 * Prompt user to set a login password after magic link login
 */
async function promptSetPassword(state: Awaited<ReturnType<typeof loadAuthState>>): Promise<void> {
  if (!state) return;

  const setPw = await p.confirm({
    message: "Set a login password for future sign-ins?",
    initialValue: true,
  });

  if (p.isCancel(setPw) || !setPw) return;

  const password = await p.password({
    message: "Create password:",
    validate: (v) => {
      if (!v) return "Password is required";
      if (v.length < 6) return "Password must be at least 6 characters";
    },
  });
  if (p.isCancel(password)) return;

  const s = p.spinner();
  s.start("Setting password...");
  try {
    await setPassword(state.accessToken, password as string);
    s.stop(pc.green("✓ Password set! You can now log in with email + password."));
  } catch (err: any) {
    s.stop(pc.red("✗ Failed to set password"));
    console.error(pc.red(err.message || "Unknown error"));
  }
}

/**
 * Complete magic link login by verifying a manually entered token.
 */
async function completeMagicLinkManual(email: string): Promise<void> {
  const token = await p.text({
    message: "Enter the magic link token:",
    validate: (v) => {
      if (!v) return "Token is required";
    },
  });
  if (p.isCancel(token)) return;

  const s = p.spinner();
  s.start("Verifying...");
  try {
    const result = await verifyMagicLink(email as string, token as string);
    const userChanged = await persistAuth(result);

    const state = await loadAuthState();
    if (state && !state.encryptionKey) {
      s.stop(pc.green("✓ Logged in!"));
      await setupEncryptionAfterAuth(state);
    } else {
      s.stop(pc.green("✓ Logged in!"));
    }

    await promptSetPassword(state);
    if (userChanged) await promptSyncChoice(state);
  } catch (err: any) {
    s.stop(pc.red("✗ Invalid or expired token"));
    console.error(pc.red(err.message || "Unknown error"));
    process.exit(1);
  }
}

/**
 * Magic link login with browser-click-to-CLI polling
 * Background polling + press Enter anytime to enter token manually
 */
async function cmdMagicLinkLogin(): Promise<void> {
  p.intro(pc.bold(pc.cyan("Magic Link Login")));

  const email = await p.text({
    message: "Email:",
    validate: (v) => {
      if (!v) return "Email is required";
      if (!v.includes("@")) return "Invalid email format";
    },
  });
  if (p.isCancel(email)) return;

  const s = p.spinner();
  s.start("Sending magic link...");

  let sessionId: string | undefined;
  try {
    const result = await sendMagicLink(email as string);
    sessionId = result.sessionId;
    s.stop(pc.green("✓ Magic link sent!"));
  } catch (err: any) {
    s.stop(pc.red("✗ Failed to send magic link"));
    console.error(pc.red(err.message || "Unknown error"));
    process.exit(1);
  }

  // No sessionId means KV is not configured (test env) — go straight to manual
  if (!sessionId) {
    await completeMagicLinkManual(email as string);
    return;
  }

  // ── Background polling with Enter-to-manual fallback ──
  console.log();
  console.log(pc.dim("Check your email and click the magic link to log in."));
  console.log(pc.dim("The CLI will detect it automatically. Press Enter to enter the token manually."));
  console.log();

  let shouldStop = false;
  let isManual = false;
  let authResult: AuthApiResponse | null = null;

  // Listen for Enter key to switch to manual mode
  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isTTY;
  if (wasRaw) {
    process.stdin.setRawMode(true);
  }

  const onKeypress = (_str: string, key: readline.Key) => {
    if (key.name === "return" || key.name === "enter") {
      shouldStop = true;
      isManual = true;
    }
    if (key.ctrl && key.name === "c") {
      cleanupStdin();
      process.exit(0);
    }
  };

  const cleanupStdin = () => {
    process.stdin.removeListener("keypress", onKeypress);
    if (wasRaw) {
      process.stdin.setRawMode(false);
    }
  };

  process.stdin.on("keypress", onKeypress);

  // Poll in background
  s.start("Waiting for browser confirmation...");

  try {
    const maxAttempts = MAGIC_LINK_MAX_ATTEMPTS;
    for (let i = 0; i < maxAttempts && !shouldStop; i++) {
      await new Promise((resolve) => setTimeout(resolve, MAGIC_LINK_POLL_INTERVAL_MS));

      try {
        const session = await checkMagicLinkSession(sessionId);

        if (session.status === "completed" && session.accessToken) {
          if (!session.refreshToken || !session.expiresAt || !session.user || !session.encryptionSalt) {
            s.stop(pc.red("✗ Incomplete session data from server"));
            process.exit(1);
          }
          authResult = {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            expiresAt: session.expiresAt,
            user: session.user,
            encryptionSalt: session.encryptionSalt,
          };
          shouldStop = true;
        }
      } catch (err: any) {
        if (err.status === 404) {
          s.stop(pc.red("✗ Session expired. Please try again."));
          process.exit(1);
        }
        // Other errors: keep polling
      }
    }
  } finally {
    s.stop();
    cleanupStdin();
  }

  if (authResult) {
    const userChanged = await persistAuth(authResult);

    const state = await loadAuthState();
    if (state && !state.encryptionKey) {
      await setupEncryptionAfterAuth(state);
    }

    await promptSetPassword(state);
    if (userChanged) await promptSyncChoice(state);

    p.outro(`Welcome back, ${pc.cyan(authResult.user.displayName || authResult.user.email)}!`);
    return;
  }

  if (isManual) {
    console.log();
    await completeMagicLinkManual(email as string);
    return;
  }

  // Timeout
  console.log(pc.red("✗ Timed out waiting for magic link confirmation."));
  console.log(pc.dim("The magic link may have expired. Please try again."));
  process.exit(1);
}

/**
 * Main auth command handler
 */
export async function handleAuthCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "register":
      await cmdRegister();
      break;
    case "login": {
      if (args.includes("--magic-link")) {
        await cmdMagicLinkLogin();
      } else {
        await cmdLogin();
      }
      break;
    }
    case "logout":
      await cmdLogout();
      break;
    case "status":
      await cmdStatus();
      break;
    case "delete-account":
      await cmdDeleteAccount();
      break;
    default:
      console.log(pc.red(`Unknown auth subcommand: ${subcommand}`));
      console.log();
      console.log(pc.bold("Available subcommands:"));
      console.log(`  ${pc.cyan("register")}       - Create a new cloud account`);
      console.log(`  ${pc.cyan("login")}          - Sign in to your account`);
      console.log(`  ${pc.cyan("login --magic-link")} - Sign in with a magic link`);
      console.log(`  ${pc.cyan("logout")}         - Sign out`);
      console.log(`  ${pc.cyan("status")}         - Check login status`);
      console.log(`  ${pc.cyan("delete-account")} - Delete your cloud account`);
      console.log();
      process.exit(1);
  }
}
