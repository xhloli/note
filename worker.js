// 辅助函数：读取请求数据
async function getFormData(request) {
  const formData = await request.formData();
  const obj = {};
  for (const [key, value] of formData.entries()) obj[key] = value;
  return obj;
}

// 验证 Cookie 中的密码是否匹配配置
async function isAuthenticated(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/auth=([^;]+)/);
  if (!match) return false;
  const config = await env.NOTE_KV.get('config', 'json');
  return config && match[1] === config.password;
}

// 返回 HTML 页面
function renderHTML(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body{background:#f8f9fa}
        .note-card{background:#fff;border-radius:8px;padding:15px;margin-bottom:15px;box-shadow:0 0 5px rgba(0,0,0,0.1);}
        .editor{min-height:300px;border:1px solid #ddd;padding:15px;margin-bottom:20px;}
        .progress-bar{transition:width 0.3s;}
        .note-card .content { white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>
    ${bodyContent}
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
    <script>${getEditorScript()}</script>
</body>
</html>`;
}

// 编辑器脚本（精简版，功能不变）
function getEditorScript() {
  return `
document.addEventListener("DOMContentLoaded",function(){
    function escapeHtml(unsafe) {
        return unsafe.replace(/[&<>"]/g, function(m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : '&quot;';
        });
    }

    function formatTime(timestamp) {
        return new Date(timestamp * 1000).toLocaleString(undefined, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }

    function createNoteCardHTML(note, isTrash) {
        const date = formatTime(note.time);
        const actions = isTrash ?
            \`<a href="/?trash=1&action=restore&id=\${note.id}" class="btn btn-sm btn-success">恢复</a>
              <a href="/?trash=1&action=purge&id=\${note.id}" class="btn btn-sm btn-danger">删除</a>\` :
            \`<button class="btn btn-sm btn-warning" data-bs-toggle="modal" data-bs-target="#editModal"
                data-note-id="\${note.id}" data-note-content="\${escapeHtml(note.content)}">编辑</button>
              <a href="/?action=delete&id=\${note.id}" class="btn btn-sm btn-danger">删除</a>\`;
        return \`
            <div class="note-card" data-note-id="\${note.id}" data-note-deleted="\${note.deleted}">
                <div class="d-flex justify-content-between mb-2">
                    <small class="text-muted time-display" data-timestamp="\${note.time}">\${date}</small>
                    <div>\${actions}</div>
                </div>
                <div class="content">\${note.content}</div>
            </div>
        \`;
    }

    function updateTrashCount(delta) {
        const trashLink = document.querySelector('a[href*="?trash=1"]');
        if (trashLink) {
            const match = trashLink.innerText.match(/\\(\\d+\\)/);
            if (match) {
                let count = parseInt(match[0].slice(1, -1)) + delta;
                if (count < 0) count = 0;
                trashLink.innerText = trashLink.innerText.replace(/\\(\\d+\\)/, '(' + count + ')');
            }
        }
    }

    function isTrashView() { return window.location.search.includes('trash=1'); }
    function getCurrentPage() { return parseInt(new URLSearchParams(window.location.search).get('page')) || 1; }
    function isFirstPage() { return getCurrentPage() === 1; }

    function insertPendingNote() {
        if (!isFirstPage() || isTrashView()) return;
        const pendingNoteJson = sessionStorage.getItem('pendingNewNote');
        if (!pendingNoteJson) return;
        try {
            const note = JSON.parse(pendingNoteJson);
            if (document.querySelector(\`.note-card[data-note-id="\${note.id}"]\`)) {
                sessionStorage.removeItem('pendingNewNote');
                return;
            }
            const notesContainer = document.querySelector('.col-lg-9');
            if (!notesContainer) return;
            const newCardHTML = createNoteCardHTML(note, false);
            const firstNoteCard = notesContainer.querySelector('.note-card');
            if (firstNoteCard) firstNoteCard.insertAdjacentHTML('beforebegin', newCardHTML);
            else notesContainer.insertAdjacentHTML('beforeend', newCardHTML);
            sessionStorage.removeItem('pendingNewNote');
        } catch (e) { sessionStorage.removeItem('pendingNewNote'); }
    }

    function initEditor(editorElem, fileInput, progressBar) {
        if (!editorElem || !fileInput || !progressBar) return;
        function uploadHandler(file) {
            const fd = new FormData(); fd.append("file", file);
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/upload");
            xhr.upload.onprogress = e => { if (e.lengthComputable) progressBar.style.width = (e.loaded / e.total * 100) + "%"; };
            xhr.onload = () => {
                if (xhr.status === 200) {
                    const data = JSON.parse(xhr.responseText);
                    const a = document.createElement("a");
                    a.href = data.url; a.textContent = file.name;
                    editorElem.appendChild(a);
                } else alert('上传失败，状态码：' + xhr.status + '\\n' + xhr.responseText);
                progressBar.style.width = "0%";
            };
            xhr.onerror = () => { alert('网络错误，上传失败'); progressBar.style.width = "0%"; };
            xhr.send(fd);
        }

        editorElem.addEventListener("paste", e => {
            const items = Array.from(e.clipboardData.items);
            const fileItem = items.find(i => i.kind === "file");
            if (fileItem) { e.preventDefault(); uploadHandler(fileItem.getAsFile()); }
        });
        editorElem.addEventListener("dragover", e => e.preventDefault());
        editorElem.addEventListener("drop", e => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) uploadHandler(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener("change", function() { if (this.files[0]) uploadHandler(this.files[0]); });
    }

    initEditor(document.querySelector("#editorModal .editor"), document.getElementById("fileUpload"), document.querySelector("#editorModal .progress-bar"));
    initEditor(document.querySelector("#editModal .editor"), document.getElementById("editFileUpload"), document.querySelector("#editModal .progress-bar"));

    // 新建笔记
    const newNoteForm = document.querySelector("#editorModal form");
    if (newNoteForm) {
        newNoteForm.addEventListener("submit", function(e) {
            e.preventDefault();
            const editor = this.querySelector(".editor");
            const hiddenInput = this.querySelector("input[name=content]");
            if (editor && hiddenInput) hiddenInput.value = editor.innerHTML;
            fetch(this.action, { method: 'POST', body: new FormData(this), credentials: 'same-origin' })
                .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error('HTTP ' + r.status + ': ' + t); }))
                .then(data => {
                    if (!data.success) throw new Error(data.error || '未知错误');
                    if (editor) editor.innerHTML = '';
                    bootstrap.Modal.getInstance(document.getElementById('editorModal')).hide();
                    if (!isTrashView()) {
                        if (isFirstPage()) {
                            const container = document.querySelector('.col-lg-9');
                            const firstCard = container.querySelector('.note-card');
                            const html = createNoteCardHTML(data.note, false);
                            if (firstCard) firstCard.insertAdjacentHTML('beforebegin', html);
                            else container.insertAdjacentHTML('beforeend', html);
                        } else {
                            sessionStorage.setItem('pendingNewNote', JSON.stringify(data.note));
                            window.location.href = '/?page=1';
                        }
                    } else alert('笔记已保存，但在垃圾箱视图中无法显示。');
                })
                .catch(err => { alert('保存失败：' + err.message); console.error(err); });
        });
    }

    // 编辑笔记
    const editNoteForm = document.querySelector("#editModal form");
    if (editNoteForm) {
        editNoteForm.addEventListener("submit", function(e) {
            e.preventDefault();
            const editor = this.querySelector(".editor");
            const hiddenInput = this.querySelector("input[name=content]");
            if (editor && hiddenInput) hiddenInput.value = editor.innerHTML;
            fetch(this.action, { method: 'POST', body: new FormData(this), credentials: 'same-origin' })
                .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error('HTTP ' + r.status + ': ' + t); }))
                .then(data => {
                    if (!data.success) throw new Error(data.error || '未知错误');
                    bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
                    const card = document.querySelector(\`.note-card[data-note-id="\${data.note.id}"]\`);
                    if (card) {
                        const timeElem = card.querySelector('.time-display');
                        if (timeElem) { timeElem.textContent = formatTime(data.note.time); timeElem.dataset.timestamp = data.note.time; }
                        card.querySelector('.content').innerHTML = data.note.content;
                        const editBtn = card.querySelector('button[data-bs-target="#editModal"]');
                        if (editBtn) editBtn.dataset.noteContent = data.note.content;
                    } else location.reload();
                })
                .catch(err => { alert('保存失败：' + err.message); console.error(err); });
        });
    }

    // 编辑模态框填充
    document.getElementById('editModal')?.addEventListener('show.bs.modal', function(e) {
        const btn = e.relatedTarget;
        this.querySelector(".editor").innerHTML = btn.dataset.noteContent || '';
        this.querySelector("input[name=id]").value = btn.dataset.noteId || '';
    });

    // 删除/恢复/永久删除
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        const deleteMatch = href?.match(/\\?action=delete&id=([^&]+)/);
        const restoreMatch = href?.match(/\\?trash=1&action=restore&id=([^&]+)/);
        const purgeMatch = href?.match(/\\?trash=1&action=purge&id=([^&]+)/);
        if (!deleteMatch && !restoreMatch && !purgeMatch) return;
        e.preventDefault();

        let action, id, confirmMsg;
        if (deleteMatch) { action = 'delete'; id = deleteMatch[1]; confirmMsg = '移到垃圾箱？'; }
        else if (restoreMatch) { action = 'restore'; id = restoreMatch[1]; confirmMsg = '恢复该笔记？'; }
        else { action = 'purge'; id = purgeMatch[1]; confirmMsg = '永久删除该笔记？'; }

        if (!confirm(confirmMsg)) return;

        fetch(href, { method: 'GET', credentials: 'same-origin' })
            .then(r => {
                if (!r.ok) throw new Error('操作失败');
                const card = document.querySelector(\`.note-card[data-note-id="\${id}"]\`);
                if (card) {
                    if (action === 'purge') { card.remove(); if (isTrashView()) updateTrashCount(-1); }
                    else if (action === 'delete') { card.remove(); updateTrashCount(1); }
                    else { card.remove(); updateTrashCount(-1); }
                } else location.reload();
            })
            .catch(err => { alert(err.message); });
    });

    // 清空垃圾箱
    document.getElementById('emptyTrashBtn')?.addEventListener('click', function(e) {
        e.preventDefault();
        if (!confirm('永久删除所有笔记？')) return;
        fetch('/?trash=1&action=empty_trash', { method: 'GET', credentials: 'same-origin' })
            .then(r => {
                if (!r.ok) throw new Error('清空失败');
                document.querySelectorAll('.note-card[data-note-deleted="true"]').forEach(c => c.remove());
                const trashLink = document.querySelector('a[href*="?trash=1"]');
                if (trashLink) trashLink.innerText = trashLink.innerText.replace(/\\(\\d+\\)/, '(0)');
            })
            .catch(err => alert(err.message));
    });

    // 页面加载时格式化静态时间并处理待插入笔记
    document.querySelectorAll('.time-display[data-timestamp]').forEach(el => {
        el.textContent = formatTime(parseInt(el.dataset.timestamp));
    });
    insertPendingNote();
});`;
}

// 主路由
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    async function getAllNotes(includeDeleted = false) {
      const list = await env.NOTE_KV.list({ prefix: 'note:' });
      const notes = [];
      for (const key of list.keys) {
        const note = await env.NOTE_KV.get(key.name, 'json');
        if (note && note.deleted === includeDeleted) notes.push(note);
      }
      return notes.sort((a, b) => b.time - a.time);
    }

    function extractFiles(content) {
      const regex = /<a[^>]+href="([^"]+)"/gi;
      const files = []; let match;
      while ((match = regex.exec(content)) !== null) files.push(match[1]);
      return files;
    }

    // 初始化
    let config = await env.NOTE_KV.get('config', 'json');
    if (!config) {
      if (path === '/' && request.method === 'POST' && url.searchParams.get('init') === '1') {
        const form = await getFormData(request);
        await env.NOTE_KV.put('config', JSON.stringify({ password: await sha256(form.password) }));
        return Response.redirect(url.origin, 302);
      }
      return new Response(renderHTML('系统初始化', `
        <div class="container" style="max-width:400px;margin:50px auto;">
          <div class="card shadow-sm"><div class="card-body">
            <h3 class="mb-3">系统初始化</h3>
            <form method="post" action="/?init=1">
              <input type="password" name="password" class="form-control mb-3" placeholder="设置初始密码" required>
              <button class="btn btn-primary w-100">初始化</button>
            </form>
          </div></div>
        </div>`), { headers: { 'Content-Type': 'text/html' } });
    }

    // 登录
    if (path === '/login' && request.method === 'POST') {
      const form = await getFormData(request);
      const hashedInput = await sha256(form.password);
      if (hashedInput === config.password) {
        return new Response(null, { status: 302, headers: {
          'Location': '/',
          'Set-Cookie': `auth=${config.password}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure`
        }});
      } else {
        return new Response(renderHTML('登录笔记本', `
          <div class="container" style="max-width:400px;margin:50px auto;">
            <div class="card shadow-sm"><div class="card-body">
              <h3 class="mb-3">登录笔记本</h3>
              <div class="alert alert-danger">密码错误！</div>
              <form method="post" action="/login">
                <input type="password" name="password" class="form-control mb-3" placeholder="输入密码" required>
                <button class="btn btn-primary w-100">登录</button>
              </form>
            </div></div>
          </div>`), { headers: { 'Content-Type': 'text/html' } });
      }
    }

    // 文件访问
    if (path.startsWith('/files/')) {
      const fileName = path.slice(7);
      try {
        const object = await env.NOTE_UPLOADS.get(fileName);
        if (!object) return new Response('File not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        return new Response(object.body, { headers });
      } catch (error) {
        return new Response('Error accessing file: ' + error.message, { status: 500 });
      }
    }

    // 认证检查
    const publicPaths = ['/login', '/upload'];
    if (!publicPaths.includes(path) && !(await isAuthenticated(request, env))) {
      return new Response(renderHTML('登录笔记本', `
        <div class="container" style="max-width:400px;margin:50px auto;">
          <div class="card shadow-sm"><div class="card-body">
            <h3 class="mb-3">登录笔记本</h3>
            <form method="post" action="/login">
              <input type="password" name="password" class="form-control mb-3" placeholder="输入密码" required>
              <button class="btn btn-primary w-100">登录</button>
            </form>
          </div></div>
        </div>`), { headers: { 'Content-Type': 'text/html' } });
    }

    // 上传
    if (path === '/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) return new Response('No file', { status: 400 });

        const ext = file.name.split('.').pop().toLowerCase();
        const allowed = ['jpg','jpeg','png','gif','bmp','webp','svg','pdf','txt','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','zip','rar','7z','tar','gz','bz2','xz','zst','mp3','mp4','avi','mov','wmv','flv','mkv','webm','ogg','wav','md','json','xml','csv','epub','mobi'];
        if (!allowed.includes(ext)) return new Response('File type not allowed. Allowed: ' + allowed.join(', '), { status: 400 });

        const fileName = `${crypto.randomUUID()}.${ext}`;
        if (!env.NOTE_UPLOADS) return new Response('R2 bucket binding "NOTE_UPLOADS" is not configured', { status: 500 });
        await env.NOTE_UPLOADS.put(fileName, file.stream(), { httpMetadata: { contentType: file.type } });
        return new Response(JSON.stringify({ url: `${url.origin}/files/${fileName}` }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response('Upload failed: ' + error.message, { status: 500 });
      }
    }

    // 保存笔记
    if (request.method === 'POST' && path === '/') {
      try {
        const form = await getFormData(request);
        const id = form.id || crypto.randomUUID();
        const content = form.content || '';
        const existingNote = form.id ? await env.NOTE_KV.get(`note:${id}`, 'json') : null;
        const note = {
          id, content, time: Math.floor(Date.now() / 1000),
          deleted: existingNote ? existingNote.deleted : false,
          files: extractFiles(content)
        };
        await env.NOTE_KV.put(`note:${id}`, JSON.stringify(note));
        return new Response(JSON.stringify({ success: true, note }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // GET 请求处理
    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      const id = url.searchParams.get('id');
      const isTrash = url.searchParams.has('trash');

      // 操作重定向
      if (action === 'delete' && id) {
        const note = await env.NOTE_KV.get(`note:${id}`, 'json');
        if (note) { note.deleted = true; await env.NOTE_KV.put(`note:${id}`, JSON.stringify(note)); }
        return Response.redirect(url.origin + (isTrash ? '?trash=1' : ''), 302);
      }
      if (action === 'restore' && id) {
        const note = await env.NOTE_KV.get(`note:${id}`, 'json');
        if (note) { note.deleted = false; await env.NOTE_KV.put(`note:${id}`, JSON.stringify(note)); }
        return Response.redirect(url.origin + '?trash=1', 302);
      }
      if (action === 'purge' && id) {
        const note = await env.NOTE_KV.get(`note:${id}`, 'json');
        if (note) {
          for (const fileUrl of note.files || []) await env.NOTE_UPLOADS.delete(fileUrl.split('/').pop());
          await env.NOTE_KV.delete(`note:${id}`);
        }
        return Response.redirect(url.origin + '?trash=1', 302);
      }
      if (action === 'empty_trash') {
        const notes = await getAllNotes(true);
        for (const note of notes) {
          for (const fileUrl of note.files || []) await env.NOTE_UPLOADS.delete(fileUrl.split('/').pop());
          await env.NOTE_KV.delete(`note:${note.id}`);
        }
        return Response.redirect(url.origin + '?trash=1', 302);
      }

      // 渲染页面
      const notes = await getAllNotes(isTrash);
      const page = parseInt(url.searchParams.get('page') || '1');
      const pageSize = 10;
      const paginatedNotes = notes.slice((page - 1) * pageSize, page * pageSize);
      const trashCount = (await getAllNotes(true)).length;

      const sidebar = isTrash ? `
        <div class="card shadow-sm"><div class="card-body">
          <a href="/" class="btn btn-primary w-100 mb-2">← 返回</a>
          <button id="emptyTrashBtn" class="btn btn-danger w-100">清空垃圾箱</button>
        </div></div>` : `
        <div class="card shadow-sm"><div class="card-body">
          <button class="btn btn-success w-100 mb-3" data-bs-toggle="modal" data-bs-target="#editorModal">✏️ 新建笔记</button>
          <a href="/?trash=1" class="btn btn-warning w-100">🗑️ 垃圾箱 (${trashCount})</a>
        </div></div>`;

      let notesHtml = '';
      for (const note of paginatedNotes) {
        const actions = isTrash ?
          `<a href="/?trash=1&action=restore&id=${note.id}" class="btn btn-sm btn-success">恢复</a>
           <a href="/?trash=1&action=purge&id=${note.id}" class="btn btn-sm btn-danger">删除</a>` :
          `<button class="btn btn-sm btn-warning" data-bs-toggle="modal" data-bs-target="#editModal"
              data-note-id="${note.id}" data-note-content="${escapeHtml(note.content)}">编辑</button>
           <a href="/?action=delete&id=${note.id}" class="btn btn-sm btn-danger">删除</a>`;
        notesHtml += `
          <div class="note-card" data-note-id="${note.id}" data-note-deleted="${note.deleted}">
            <div class="d-flex justify-content-between mb-2">
              <small class="text-muted time-display" data-timestamp="${note.time}"></small>
              <div>${actions}</div>
            </div>
            <div class="content">${note.content}</div>
          </div>`;
      }

      const paginationHtml = notes.length > pageSize ? `<nav class="mt-4"><ul class="pagination justify-content-center">${
        Array.from({ length: Math.ceil(notes.length / pageSize) }, (_, i) =>
          `<li class="page-item ${i+1 === page ? 'active' : ''}"><a class="page-link" href="/?${isTrash ? 'trash=1&' : ''}page=${i+1}">${i+1}</a></li>`
        ).join('')
      }</ul></nav>` : '';

      const editModalContent = `
        <div class="modal fade" id="editModal"><div class="modal-dialog modal-lg"><div class="modal-content">
          <form method="post" action="/">
            <input type="hidden" name="id" value="">
            <div class="modal-header"><h5 class="modal-title">编辑笔记</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
              <div class="editor" contenteditable></div>
              <input type="hidden" name="content">
              <div class="mt-3">
                <input type="file" id="editFileUpload" hidden>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('editFileUpload').click()">上传文件</button>
                <small class="text-muted ms-2">支持拖拽/粘贴文件</small>
                <div class="progress"><div class="progress-bar"></div></div>
              </div>
            </div>
            <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button><button type="submit" class="btn btn-primary">保存修改</button></div>
          </form>
        </div></div></div>`;

      const mainHtml = `
        <div class="container py-4"><div class="row"><div class="col-lg-3 mb-4">${sidebar}</div><div class="col-lg-9">
          <div class="modal fade" id="editorModal"><div class="modal-dialog modal-lg"><div class="modal-content">
            <form method="post" action="/">
              <div class="modal-header"><h5 class="modal-title">新建笔记</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
              <div class="modal-body">
                <div class="editor" contenteditable></div>
                <input type="hidden" name="content">
                <div class="mt-3">
                  <input type="file" id="fileUpload" hidden>
                  <button type="button" class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('fileUpload').click()">上传文件</button>
                  <small class="text-muted ms-2">支持拖拽/粘贴文件</small>
                  <div class="progress"><div class="progress-bar"></div></div>
                </div>
              </div>
              <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button><button type="submit" class="btn btn-primary">保存</button></div>
            </form>
          </div></div></div>
          ${editModalContent}
          ${notesHtml}
          ${paginationHtml}
        </div></div></div>`;

      return new Response(renderHTML(isTrash ? '垃圾箱' : '私人笔记本', mainHtml), { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// 工具函数
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}