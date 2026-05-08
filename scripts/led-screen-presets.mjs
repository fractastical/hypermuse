/**
 * Venue LED targets (content pixel aspect — scale up/down in processor if needed).
 *
 * Main bar: 15×6.5 ft wall, content 16:9
 * DJ screen: 6.5×4.5 ft ≈ 13:9 (1.44:1)
 *
 * Override any preset with EXPORT_WIDTH + EXPORT_HEIGHT (positive integers).
 */
export function resolveLedExportSize(env = process.env) {
  const EXPORT_PROFILE = String(env.EXPORT_PROFILE || "hd").trim().toLowerCase();
  const EXPORT_WIDTH = Number.parseInt(env.EXPORT_WIDTH || "0", 10);
  const EXPORT_HEIGHT = Number.parseInt(env.EXPORT_HEIGHT || "0", 10);
  if (
    Number.isFinite(EXPORT_WIDTH) && Number.isFinite(EXPORT_HEIGHT)
    && EXPORT_WIDTH > 0 && EXPORT_HEIGHT > 0
  ) {
    return { width: EXPORT_WIDTH, height: EXPORT_HEIGHT, profile: "custom" };
  }

  if (
    EXPORT_PROFILE === "led_main_bar"
    || EXPORT_PROFILE === "led_main_16x9"
    || EXPORT_PROFILE === "main_bar"
  ) {
    return { width: 1920, height: 1080, profile: "led_main_bar" };
  }
  if (EXPORT_PROFILE === "led_main_4k" || EXPORT_PROFILE === "main_bar_4k") {
    return { width: 3840, height: 2160, profile: "led_main_4k" };
  }

  if (
    EXPORT_PROFILE === "wall_13x9"
    || EXPORT_PROFILE === "13x9"
    || EXPORT_PROFILE === "led_dj"
    || EXPORT_PROFILE === "dj_led"
  ) {
    return { width: 1872, height: 1296, profile: "wall_13x9" };
  }

  return { width: 1920, height: 1080, profile: "hd" };
}
