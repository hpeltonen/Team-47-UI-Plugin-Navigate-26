/**
 * Build the Launchpad URL for a launched Interactive Process.
 *
 * The plugin runs in an iframe, so it cannot render the workflow's Interactive
 * Form / Interactive Message steps itself — those are owned by the Launchpad.
 * Starting a launcher only returns an ID, so the plugin hands the user off to
 * the Launchpad to complete and watch the process.
 *
 * The tenant host is not in the plugin context as a URL, so it is derived from
 * the COIP page route (the App Shell's own location).
 */
export function buildInteractiveProcessUrl(
  pageRoute: string | null | undefined,
  interactiveProcessId: string | null | undefined,
): string | null {
  if (!pageRoute || !interactiveProcessId) {
    return null;
  }

  try {
    const origin = new URL(pageRoute).origin;
    return `${origin}/ui/d/launchpad/interactive-processes/${encodeURIComponent(interactiveProcessId)}`;
  } catch {
    return null;
  }
}
