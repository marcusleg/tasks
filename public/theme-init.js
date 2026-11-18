// Applies the stored colour theme before the page paints (avoids a flash of the wrong theme).
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
