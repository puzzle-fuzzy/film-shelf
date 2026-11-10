import { OverlayScrollbars, type PartialOptions } from "overlayscrollbars";

const selector = "[data-film-scrollbars]";
const scrollbarOptions: PartialOptions["scrollbars"] = {
  theme: "os-theme-film-shelf",
  autoHide: "move",
  autoHideDelay: 900,
  autoHideSuspend: true,
  dragScroll: true,
};

function attachScrollbars(target: HTMLElement) {
  const axis = target.dataset.filmScrollbars;
  return OverlayScrollbars(
    { target, elements: { viewport: target } },
    {
      overflow: {
        x: axis === "vertical" ? "hidden" : "scroll",
        y: axis === "horizontal" ? "hidden" : "scroll",
      },
      scrollbars: scrollbarOptions,
    },
    {
      initialized(instance) {
        const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
        for (const { scrollbar } of [scrollbarHorizontal, scrollbarVertical]) {
          scrollbar.setAttribute("aria-hidden", "true");
          scrollbar.setAttribute("data-vaul-no-drag", "");
        }
      },
    },
  );
}

export function mountOverlayScrollbars({ nested = false } = {}) {
  const page = attachScrollbars(document.body);
  if (!nested) return () => page.destroy();

  const instances = new Map<HTMLElement, OverlayScrollbars>();
  function attach(target: HTMLElement) {
    if (!instances.has(target)) instances.set(target, attachScrollbars(target));
  }

  function attachWithin(node: HTMLElement) {
    if (node.matches(selector)) attach(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(attach);
  }

  // Admin dialogs and menus mount their scroll surfaces in separate portals.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.isConnected) attachWithin(node);
      }
    }
    for (const [target, instance] of instances) {
      if (!target.isConnected) {
        instance.destroy();
        instances.delete(target);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  attachWithin(document.body);

  return () => {
    observer.disconnect();
    instances.forEach((instance) => instance.destroy());
    page.destroy();
  };
}
