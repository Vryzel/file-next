export function swallowClickThrough(): void {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerup", swallow, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerup", swallow, true);
  window.setTimeout(() => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerup", swallow, true);
  }, 400);
}
