export function link(node) {
  const onClick = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    window.__previewNavigation = node.getAttribute('href');
  };
  node.addEventListener('click', onClick);
  return { destroy: () => node.removeEventListener('click', onClick) };
}

export function navigate(path) {
  window.__previewNavigation = path;
}
