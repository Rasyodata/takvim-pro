// Tema, ilk boyamadan önce uygulanır (yanıp sönmeyi önler)
(function () {
  try {
    var t = localStorage.getItem('takvim.theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
  } catch (e) { /* yoksay */ }
})();
