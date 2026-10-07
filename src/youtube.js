/* Vídeo do YouTube dentro do app, em cima da cifra */

/* aceita link do navegador, do app (youtu.be), shorts, ao vivo ou só o código do vídeo */
export function ytId(url) {
  const s = String(url || '').trim();
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})(?![\w-])/i.exec(s);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : '';
}
export const ytWatch = id => 'https://www.youtube.com/watch?v=' + id;
export const ytThumb = id => 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
export const ytEmbed = id => 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
export const ytSearch = q => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(String(q || '').trim() || 'louvor');
