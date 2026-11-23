const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  images: '<rect x="4" y="5" width="16" height="15" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 5-5 4 4 3-3 3 4M8 2h9"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3M7 7h.01"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  shield: '<path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  logout: '<path d="M9 4H5v16h4m5-12 4 4-4 4m-5-4h12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.images}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
hydrateIcons();
const state = { view: 'gallery', page: 1, images: [], selected: new Set(), layout: 'grid', stats: null, config: null, detail: null, linkType: 'url', queue: [], workers: 0, generation: 0, authenticated: false };
let toastTimer;
let nextQueueId = 0;
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 6500 : 3000);
}
function showError(error) { $('#global-error').textContent = error.message; $('#global-error').hidden = false; }
async function api(path, options = {}) {
  const response = await fetch('/api/v1' + path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/session') showLogin();
    const error = new Error(result.error?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return result;
}
const patchImage = (id, data) => api('/images/' + id, { method: 'PATCH', body: JSON.stringify(data) });
function bytes(value) {
  if (!value) return ['0', 'B'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return [(value / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit > 0 ? 1 : 0 }), ['B', 'KB', 'MB', 'GB', 'TB'][unit]];
}
const byteLabel = value => bytes(value).join(' ');
const dateLabel = value => new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
const fullDate = value => new Date(value).toLocaleString('zh-CN', { hour12: false });

function showLogin() {
  state.authenticated = false;
  state.generation++;
  state.images = [];
  state.selected.clear();
  state.detail = null;
  state.queue = [];
  state.stats = null;
  $('#gallery').replaceChildren();
  $('#key-list').replaceChildren();
  $('#queue-items').replaceChildren();
  $('#workspace').hidden = true;
  $('#login').hidden = false;
  $('#boot').hidden = true;
  $$('dialog[open]').forEach(dialog => dialog.close());
  $('#new-secret').textContent = '';
  closeMenu();
}
async function openWorkspace() {
  state.authenticated = true;
  $('#login').hidden = true;
  $('#boot').hidden = true;
  $('#workspace').hidden = false;
  $('#admin-token').value = '';
  state.config = (await api('/config')).data;
  $('#upload-limits').textContent = `PNG、JPG、GIF、WebP、AVIF · 单张最大 ${byteLabel(state.config.max_upload_bytes)}`;
  setupDocs();
  await navigate('gallery');
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  button.textContent = '正在登录…';
  $('#login-error').textContent = '';
  try {
    await api('/session', { method: 'POST', body: JSON.stringify({ token: $('#admin-token').value }) });
    await openWorkspace();
  } catch (error) { if (state.authenticated) showError(error); else $('#login-error').textContent = error.message; }
  finally { button.disabled = false; button.textContent = '进入工作空间'; }
});

async function loadStats() {
  const result = await api('/stats');
  if (!state.authenticated) return;
  state.stats = result.data;
  const stats = result.data;
  $('#nav-count').textContent = stats.images.toLocaleString();
  $('#stat-images').innerHTML = `${stats.images.toLocaleString()}<small>张</small>`;
  const [value, unit] = bytes(stats.bytes);
  $('#stat-bytes').innerHTML = `${value}<small>${unit}</small>`;
  $('#stat-favorites').innerHTML = `${stats.favorites.toLocaleString()}<small>张</small>`;
  const percent = stats.bytes / stats.storage_limit_bytes * 100;
  $('#storage-percent').textContent = percent.toFixed(1) + '%';
  $('#storage-progress').value = percent;
  $('#storage-summary').textContent = `${byteLabel(stats.bytes)} / ${byteLabel(stats.storage_limit_bytes)}`;
  $('#storage-driver').textContent = stats.storage_driver === 's3' ? 'S3 兼容存储' : '本地磁盘存储';
  const current = $('#album-filter').value;
  $('#album-filter').innerHTML = '<option value="*">全部相册</option><option value="">未分类</option>' + stats.albums.map(a => `<option value="${esc(a.name)}">${esc(a.name)} (${a.count})</option>`).join('');
  // 星号本身也允许成为相册名，通过后端同样的值区分不可靠，UI 选项改用索引。
  [...$('#album-filter').options].slice(2).forEach((option, index) => { option.value = 'album:' + stats.albums[index].name; });
  $('#album-filter').value = [...$('#album-filter').options].some(o => o.value === current) ? current : '*';
}
const viewInfo = {
  gallery: ['我的图库', '收藏每一份灵感，让图片分享更简单。'], favorites: ['我的收藏', '偏爱的图片，随时都能找到。'], albums: ['相册管理', '给图片分个类，让灵感井井有条。'], keys: ['API 密钥', '把你的图床，连接到更多可能。'], docs: ['接口文档', '几行代码，让图片自然融入你的工作流。'],
};
async function navigate(view) {
  if (!viewInfo[view]) return;
  state.view = view;
  state.page = 1;
  state.selected.clear();
  state.generation++;
  $('#global-error').hidden = true;
  const [title, description] = viewInfo[view];
  $('#page-title').innerHTML = esc(title) + '<span class="title-dot">.</span>';
  $('#breadcrumb-title').textContent = title;
  $('#page-description').textContent = description;
  $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  ['gallery', 'albums', 'keys', 'docs'].forEach(v => { $('#' + v + '-view').hidden = v !== (view === 'favorites' ? 'gallery' : view); });
  $('#gallery-title').innerHTML = (view === 'favorites' ? '收藏图片' : '全部图片') + ' <span id="result-count">0</span>';
  closeMenu();
  try {
    await loadStats();
    if (view !== state.view) return;
    if (view === 'gallery' || view === 'favorites') await loadImages();
    else if (view === 'albums') renderAlbums();
    else if (view === 'keys') await loadKeys();
  } catch (error) { showError(error); }
}
async function loadImages() {
  const generation = ++state.generation;
  $('#gallery').innerHTML = '<div class="loading-state">正在整理你的图片…</div>';
  $('#pagination').hidden = true;
  state.selected.clear();
  renderSelection();
  const query = new URLSearchParams({ page: state.page, limit: '24' });
  if ($('#search').value.trim()) query.set('q', $('#search').value.trim());
  if ($('#format-filter').value) query.set('format', $('#format-filter').value);
  const album = $('#album-filter').value;
  if (album !== '*') query.set('album', album.startsWith('album:') ? album.slice(6) : album);
  if (state.view === 'favorites') query.set('favorite', 'true');
  try {
    const result = await api('/images?' + query);
    if (generation !== state.generation || !state.authenticated) return;
    if (result.pagination.pages > 0 && state.page > result.pagination.pages) { state.page = result.pagination.pages; return loadImages(); }
    state.images = result.data;
    $('#result-count').textContent = result.pagination.total.toLocaleString();
    renderImages();
    $('#pagination').hidden = result.pagination.pages <= 1;
    $('#page-info').textContent = `共 ${result.pagination.total} 张 · 第 ${state.page} / ${result.pagination.pages || 1} 页`;
    $('#prev-page').disabled = state.page <= 1;
    $('#next-page').disabled = state.page >= result.pagination.pages;
    $('#global-error').hidden = true;
  } catch (error) {
    if (generation !== state.generation) return;
    $('#gallery').innerHTML = empty('加载图片失败', error.message, 'refresh', '重试');
    showError(error);
  }
}
function empty(title, description, action = '', label = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon('images')}</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button class="button secondary" data-action="${action}">${icon(action === 'upload' ? 'plus' : 'refresh')}${esc(label)}</button>` : ''}</div>`;
}
function renderImages() {
  $('#gallery').classList.toggle('gallery-list', state.layout === 'list');
  if (!state.images.length) {
    const filtered = $('#search').value || $('#format-filter').value || $('#album-filter').value !== '*' || state.view === 'favorites';
    $('#gallery').innerHTML = filtered ? empty('这里暂时没有图片', '试试调整筛选条件，或为喜欢的图片点亮收藏。') : empty('你的图片空间，准备好了', '上传第一张图片，把灵感存进来。每次分享，都从这里开始。', 'upload', '上传第一张图片');
    return;
  }
  $('#gallery').innerHTML = state.images.map(image => `<article class="image-card ${state.selected.has(image.id) ? 'selected' : ''}" data-id="${image.id}"><div class="image-preview"><label class="image-check"><input type="checkbox" data-select="${image.id}" aria-label="选择 ${esc(image.name)}" ${state.selected.has(image.id) ? 'checked' : ''}></label><button data-detail="${image.id}" aria-label="查看 ${esc(image.name)}"><img src="${esc(image.url)}" alt="${esc(image.name)}" loading="lazy" decoding="async"></button><span class="format-badge">${esc(image.format.toUpperCase())}</span></div><div class="image-meta"><button class="image-name" data-detail="${image.id}" title="${esc(image.name)}">${esc(image.name)}</button><div class="image-sub"><span>${byteLabel(image.size)}</span><time datetime="${image.created_at}">${dateLabel(image.created_at)}</time></div><div class="image-actions"><button class="icon-button ${image.favorite ? 'favorited' : ''}" data-favorite="${image.id}" aria-label="${image.favorite ? '取消收藏' : '收藏'} ${esc(image.name)}" aria-pressed="${image.favorite}">${icon('heart')}</button><button class="icon-button" data-delete="${image.id}" aria-label="删除 ${esc(image.name)}">${icon('trash')}</button><button class="copy-button" data-copy-image="${image.id}">${icon('copy')}复制链接</button></div></div></article>`).join('');
}
function renderSelection() {
  $('#selection-bar').hidden = !state.selected.size;
  $('#selected-count').textContent = `已选 ${state.selected.size} 张`;
  $('#select-all').checked = state.images.length > 0 && state.selected.size === state.images.length;
  $('#select-all').indeterminate = state.selected.size > 0 && state.selected.size < state.images.length;
  $$('.image-card').forEach(card => { card.classList.toggle('selected', state.selected.has(card.dataset.id)); const box = card.querySelector('[data-select]'); if (box) box.checked = state.selected.has(card.dataset.id); });
}
function renderAlbums() {
  const stats = state.stats;
  if (!stats?.images) { $('#album-cards').innerHTML = empty('每一份灵感，都可以有个分类', '上传时，或在图片详情中填写相册名称，即可创建相册。', 'upload', '上传图片'); return; }
  const albums = [...stats.albums];
  const uncategorized = stats.images - albums.reduce((sum, a) => sum + a.count, 0);
  if (uncategorized) albums.unshift({ name: '', count: uncategorized });
  $('#album-cards').innerHTML = albums.map(a => `<button class="album-card" data-album="${esc(a.name)}"><span>${icon('folder')}</span><h2>${esc(a.name || '未分类')}</h2><p>${a.count} 张图片</p></button>`).join('');
}
async function refresh() {
  $('#global-error').hidden = true;
  await loadStats();
  if (['gallery', 'favorites'].includes(state.view)) await loadImages();
  else if (state.view === 'albums') renderAlbums();
  else if (state.view === 'keys') await loadKeys();
}
async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('已复制到剪贴板'); }
  catch {
    // 非 HTTPS 的自托管环境保留可手工复制的后备路径。
    window.prompt('浏览器未允许访问剪贴板，请手动复制：', value);
  }
}
async function removeImages(ids) {
  if (!ids.length || !confirm(`确定永久删除 ${ids.length} 张图片吗？分享链接将立即失效，此操作无法撤销。`)) return;
  let deleted = 0;
  const errors = [];
  for (const id of ids) {
    try { await api('/images/' + id, { method: 'DELETE' }); deleted++; state.selected.delete(id); }
    catch (error) { errors.push(error.message); }
  }
  if (state.detail && ids.includes(state.detail.id)) $('#detail-dialog').close();
  toast(errors.length ? `已删除 ${deleted} 张；${errors.length} 张失败：${errors[0]}` : `已删除 ${deleted} 张图片`, Boolean(errors.length));
  if (state.authenticated) await refresh();
}
async function openDetail(id) {
  const image = (await api('/images/' + id)).data;
  state.detail = image;
  state.linkType = 'url';
  $('#detail-content').innerHTML = `<div class="detail-body"><div class="detail-preview"><img src="${esc(image.url)}" alt="${esc(image.name)}"></div><div class="detail-info"><small>${esc(image.format.toUpperCase())} · ${byteLabel(image.size)} · ${fullDate(image.created_at)}</small><form id="detail-form"><label>图片名称<input id="detail-name" value="${esc(image.name)}" required maxlength="240"></label><label>所属相册<input id="detail-album" value="${esc(image.album)}" placeholder="输入名称以创建或加入相册" maxlength="80" list="album-suggestions"></label><datalist id="album-suggestions">${(state.stats?.albums || []).map(a => `<option value="${esc(a.name)}"></option>`).join('')}</datalist><button class="button secondary small" type="submit">保存修改</button></form><div class="section-top"><h2>分享链接</h2></div><div class="link-tabs">${['url', 'markdown', 'html', 'bbcode'].map(type => `<button data-link-type="${type}" class="${type === 'url' ? 'active' : ''}">${type === 'url' ? '直链' : type === 'markdown' ? 'Markdown' : type.toUpperCase()}</button>`).join('')}</div><div class="link-box"><code id="detail-link"></code><button class="icon-button" data-action="copy-detail" aria-label="复制分享链接">${icon('copy')}</button></div><div class="detail-footer"><a href="${esc(image.url)}" target="_blank" rel="noopener noreferrer">查看原图</a><button class="text-button danger" data-delete="${image.id}">永久删除</button></div></div></div>`;
  $('#detail-link').textContent = image.links.url;
  $('#detail-dialog').showModal();
  $('#detail-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await patchImage(id, { name: $('#detail-name').value, album: $('#detail-album').value });
      state.detail = result.data;
      $('#detail-link').textContent = state.detail.links[state.linkType];
      toast('图片信息已更新');
      await refresh();
    } catch (error) { toast(error.message, true); }
    finally { button.disabled = false; }
  });
}

const scopeNames = { upload: '仅上传', read: '仅读取', manage: '图片管理' };
async function loadKeys() {
  $('#key-list').innerHTML = '<div class="loading-state">正在加载密钥…</div>';
  const result = await api('/keys');
  if (!state.authenticated) return;
  if (!result.data.length) { $('#key-list').innerHTML = empty('还没有 API 密钥', '创建一个独立密钥，将 pppic 接入你的应用。'); return; }
  $('#key-list').innerHTML = `<div class="section-top"><h2>已创建的密钥 <span class="scope-tag">${result.data.length}</span></h2></div><div class="table-scroll"><table><thead><tr><th>密钥名称</th><th>密钥前缀</th><th>权限</th><th>最近使用</th><th>操作</th></tr></thead><tbody>${result.data.map(key => `<tr><td class="key-name-cell">${esc(key.name)}</td><td><code>${esc(key.prefix)}…</code></td><td><span class="scope-tag">${scopeNames[key.scope]}</span></td><td>${key.last_used_at ? fullDate(key.last_used_at) : '尚未使用'}</td><td><button class="text-button danger" data-revoke="${key.id}">撤销</button></td></tr>`).join('')}</tbody></table></div>`;
}
$('#create-key-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/keys', { method: 'POST', body: JSON.stringify({ name: $('#key-name').value, scope: $('#key-scope').value }) });
    $('#new-secret').textContent = result.data.token;
    $('#secret-dialog').showModal();
    $('#key-name').value = '';
    await loadKeys();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$('#secret-dialog').addEventListener('close', () => { $('#new-secret').textContent = ''; });
$('#detail-dialog').addEventListener('close', () => { state.detail = null; $('#detail-content').replaceChildren(); });
function setupDocs() {
  const base = state.config.public_url;
  $('#curl-upload').textContent = `curl -X POST '${base}/api/v1/images' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -F 'file=@/path/to/image.png' \\\n  -F 'album=我的博客'`;
  $('#curl-list').textContent = `curl '${base}/api/v1/images?page=1&limit=24' \\\n  -H 'Authorization: Bearer YOUR_API_KEY'`;
  const endpoints = [['POST', '/api/v1/images', '上传图片 · upload / manage'], ['GET', '/api/v1/images', '分页、搜索、筛选 · read / manage'], ['GET', '/api/v1/images/{id}', '图片详情 · read / manage'], ['PATCH', '/api/v1/images/{id}', '修改名称 / 相册 / 收藏 · manage'], ['DELETE', '/api/v1/images/{id}', '永久删除图片 · manage'], ['GET', '/api/v1/stats', '存储、图片和相册统计 · read / manage'], ['GET / POST', '/api/v1/keys', '列出 / 创建密钥 · 仅管理员'], ['DELETE', '/api/v1/keys/{id}', '撤销密钥 · 仅管理员'], ['GET', '/i/{id}.{ext}', '公开图片直链 · 无需认证']];
  $('#endpoint-table').innerHTML = endpoints.map(row => `<tr><td><span class="scope-tag">${row[0]}</span></td><td><code>${row[1]}</code></td><td>${row[2]}</td></tr>`).join('');
}

function renderQueue() {
  $('#upload-queue').hidden = !state.queue.length;
  $('#queue-items').innerHTML = state.queue.map(item => `<div class="queue-item ${item.status === 'failed' ? 'failed' : ''}"><span class="queue-icon">${icon(item.status === 'done' ? 'check' : 'images')}</span><div class="queue-details"><div class="queue-name">${esc(item.name)}</div><small>${esc(item.message || byteLabel(item.size))}</small>${['uploading', 'waiting'].includes(item.status) ? `<progress value="${item.progress}" max="100" aria-label="${esc(item.name)} 上传进度"></progress>` : ''}</div><span class="queue-status">${{ waiting: '等待上传', uploading: item.progress === 100 ? '正在保存' : item.progress + '%', done: '已完成', failed: '失败' }[item.status]}</span>${item.status === 'done' ? `<button class="icon-button" data-queue-copy="${item.id}" aria-label="复制 ${esc(item.name)} 的链接">${icon('copy')}</button>` : ''}${item.status === 'failed' && item.file ? `<button class="text-button" data-retry="${item.id}">重试</button>` : ''}</div>`).join('');
}
function upload(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/images');
    xhr.timeout = 65000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) { item.progress = Math.round(event.loaded / event.total * 100); renderQueue(); } };
    xhr.onload = () => {
      let result;
      try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('服务器响应格式错误')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else { if (xhr.status === 401) showLogin(); reject(new Error(result.error?.message || '上传失败')); }
    };
    xhr.onerror = () => reject(new Error('网络连接失败，请检查后重试'));
    xhr.ontimeout = () => reject(new Error('上传超时，请稍后重试'));
    const form = new FormData();
    form.append('file', item.file);
    if (item.album) form.append('album', item.album);
    xhr.send(form);
  });
}
function processQueue() {
  while (state.workers < 3 && state.authenticated) {
    const item = state.queue.find(q => q.status === 'waiting');
    if (!item) break;
    state.workers++;
    item.status = 'uploading';
    renderQueue();
    upload(item).then(result => {
      item.status = 'done'; item.url = result.data.url;
      item.message = result.created ? byteLabel(item.size) + ' · 上传成功' : '相同内容已存在，已复用原图链接';
      item.file = null;
    }).catch(error => { item.status = 'failed'; item.message = error.message; }).finally(async () => {
      state.workers--;
      if (!state.authenticated) return;
      renderQueue();
      processQueue();
      if (!state.workers && !state.queue.some(q => q.status === 'waiting')) {
        try { await refresh(); } catch (error) { showError(error); }
      }
    });
  }
}
function addFiles(files) {
  if (!state.authenticated) return;
  const list = [...files];
  if (!list.length) return;
  if (state.queue.length + list.length > 100) { toast('一次最多保留 100 个上传任务，请先清除已完成任务', true); return; }
  const album = $('#album-filter').value;
  for (const file of list) {
    const item = { id: String(++nextQueueId), name: file.name, size: file.size, file, status: 'waiting', progress: 0, album: album.startsWith('album:') ? album.slice(6) : '' };
    if (file.size > state.config.max_upload_bytes) { item.status = 'failed'; item.message = `超过 ${byteLabel(state.config.max_upload_bytes)} 大小限制`; item.file = null; }
    else if (!/\.(png|jpe?g|gif|webp|avif)$/i.test(file.name) && !/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) { item.status = 'failed'; item.message = '不支持的图片格式'; item.file = null; }
    state.queue.push(item);
  }
  if (!['gallery', 'favorites'].includes(state.view)) navigate('gallery');
  renderQueue();
  processQueue();
}
$('#file-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
$('#dropzone').addEventListener('click', () => $('#file-input').click());
$('#dropzone').addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); $('#file-input').click(); } });
for (const eventName of ['dragenter', 'dragover']) $('#dropzone').addEventListener(eventName, event => { event.preventDefault(); $('#dropzone').classList.add('dragover'); });
for (const eventName of ['dragleave', 'drop']) $('#dropzone').addEventListener(eventName, event => { event.preventDefault(); $('#dropzone').classList.remove('dragover'); });
$('#dropzone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('paste', event => { if (state.authenticated && event.clipboardData.files.length && !event.target.closest('input,textarea,[contenteditable],dialog')) { event.preventDefault(); addFiles(event.clipboardData.files); } });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'u' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable],dialog') && state.authenticated) { event.preventDefault(); $('#file-input').click(); }
  if (event.key === 'Escape') closeMenu();
});
let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.page = 1; loadImages(); }, 250); });
for (const selector of ['#format-filter', '#album-filter']) $(selector).addEventListener('change', () => { state.page = 1; loadImages(); });
$('#reset-filters').addEventListener('click', () => { $('#search').value = ''; $('#format-filter').value = ''; $('#album-filter').value = '*'; state.page = 1; loadImages(); });
$('#prev-page').addEventListener('click', () => { state.page--; loadImages(); });
$('#next-page').addEventListener('click', () => { state.page++; loadImages(); });
$('#select-all').addEventListener('change', event => { state.selected = new Set(event.target.checked ? state.images.map(i => i.id) : []); renderSelection(); });
document.addEventListener('change', event => { if (event.target.dataset.select) { const id = event.target.dataset.select; if (event.target.checked) state.selected.add(id); else state.selected.delete(id); renderSelection(); } });
function closeMenu() { $('#sidebar').classList.remove('open'); $('#mobile-overlay').hidden = true; $('#menu-toggle').setAttribute('aria-expanded', 'false'); }
$('#menu-toggle').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#mobile-overlay').hidden = !open; $('#menu-toggle').setAttribute('aria-expanded', String(open)); });
$('#mobile-overlay').addEventListener('click', closeMenu);
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  try {
    if (button.dataset.view) return await navigate(button.dataset.view);
    if (button.dataset.close) return $('#' + button.dataset.close).close();
    if (button.dataset.layout) { state.layout = button.dataset.layout; $$('[data-layout]').forEach(el => { el.classList.toggle('active', el === button); el.setAttribute('aria-pressed', String(el === button)); }); renderImages(); return; }
    if (button.dataset.detail) return await openDetail(button.dataset.detail);
    if (button.dataset.copyImage) return await copy(state.images.find(i => i.id === button.dataset.copyImage).url);
    if (button.dataset.favorite) {
      button.disabled = true;
      const image = state.images.find(i => i.id === button.dataset.favorite);
      await patchImage(image.id, { favorite: !image.favorite });
      await refresh();
      return;
    }
    if (button.dataset.delete) return await removeImages([button.dataset.delete]);
    if (button.hasAttribute('data-album')) { const album = button.dataset.album; $('#search').value = ''; $('#format-filter').value = ''; await navigate('gallery'); $('#album-filter').value = album ? 'album:' + album : ''; state.page = 1; await loadImages(); return; }
    if (button.dataset.linkType && state.detail) { state.linkType = button.dataset.linkType; $$('[data-link-type]').forEach(el => el.classList.toggle('active', el === button)); $('#detail-link').textContent = state.detail.links[state.linkType]; return; }
    if (button.dataset.revoke && confirm('确定撤销这个 API 密钥吗？使用此密钥的应用将无法继续访问。')) { await api('/keys/' + button.dataset.revoke, { method: 'DELETE' }); await loadKeys(); toast('密钥已撤销'); return; }
    if (button.dataset.copyCode) return await copy($(button.dataset.copyCode === 'upload' ? '#curl-upload' : '#curl-list').textContent);
    if (button.dataset.queueCopy) return await copy(state.queue.find(i => i.id === button.dataset.queueCopy).url);
    if (button.dataset.retry) { const item = state.queue.find(i => i.id === button.dataset.retry); item.status = 'waiting'; item.progress = 0; item.message = ''; processQueue(); return; }
    switch (button.dataset.action) {
      case 'upload': closeMenu(); $('#file-input').click(); break;
      case 'refresh': button.disabled = true; await refresh(); break;
      case 'logout': await api('/session', { method: 'DELETE' }); showLogin(); break;
      case 'clear-queue': state.queue = state.queue.filter(i => ['waiting', 'uploading'].includes(i.status)); renderQueue(); break;
      case 'copy-selected': await copy(state.images.filter(i => state.selected.has(i.id)).map(i => i.url).join('\n')); break;
      case 'delete-selected': button.disabled = true; await removeImages([...state.selected]); break;
      case 'clear-selection': state.selected.clear(); renderSelection(); break;
      case 'copy-detail': await copy(state.detail.links[state.linkType]); break;
      case 'copy-secret': await copy($('#new-secret').textContent); break;
    }
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
try { await api('/session'); await openWorkspace(); }
catch (error) { if (state.authenticated) showError(error); else { showLogin(); if (error.status !== 401) $('#login-error').textContent = '服务连接失败，请刷新后重试'; } }
