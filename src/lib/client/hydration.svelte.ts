/**
 * Whether the page has hydrated. Server-rendered controls that need client JS (they would do
 * nothing, or lose the input, before their handlers are attached) are `disabled` until then.
 * Set once by the root layout; `document.documentElement.dataset.hydrated` mirrors it for e2e.
 */
export const hydration = $state({ done: false });
