// Avisos compartidos de Suite A33. No escribe datos persistentes.
(function(g){
  'use strict';
  const labels = {process:'En proceso', success:'Correcto', error:'Error', pending:'Pendiente'};
  const icons = {process:'↻', success:'✓', error:'×', pending:'!'};
  const entries = new Map();
  let sequence = 0;
  function dismiss(id){
    const entry = entries.get(id);
    if (!entry) return;
    g.clearTimeout(entry.timer);
    entry.node.remove();
    entries.delete(id);
  }
  function show(message, type, options){
    type = Object.prototype.hasOwnProperty.call(labels, type) ? type : 'success';
    options = options || {};
    let region = document.getElementById('a33-notify-region');
    if (!region){
      region = document.createElement('div');
      region.id = 'a33-notify-region';
      region.className = 'a33-notify-region';
      region.setAttribute('aria-label', 'Avisos de operaciones');
      document.body.appendChild(region);
    }
    const id = options.id || ('a33-notice-' + (++sequence));
    dismiss(id);
    const node = document.createElement('article');
    node.className = 'a33-notice is-' + type;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-atomic', 'true');
    const icon = document.createElement('span');
    icon.className = 'a33-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = icons[type];
    const content = document.createElement('div');
    content.className = 'a33-notice-content';
    const title = document.createElement('strong');
    title.textContent = labels[type];
    const text = document.createElement('span');
    text.textContent = String(message || labels[type]);
    content.appendChild(title);
    content.appendChild(text);
    node.appendChild(icon);
    node.appendChild(content);
    region.appendChild(node);
    entries.set(id, {node, timer:g.setTimeout(()=>dismiss(id), type === 'error' ? 7000 : 5000)});
    return id;
  }
  g.A33Notify = Object.freeze({show, dismiss});
})(window);
