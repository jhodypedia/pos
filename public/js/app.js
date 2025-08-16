// public/js/app.js
/* Single app.js for Public + Admin behaviour
   - Ensure this file is loaded last (after jQuery, Bootstrap, DataTables, QRCode, Chart.js, Toastr)
   - Contains:
     * Public SPA: product grid, cart, checkout (AJAX), show QR, polling order status, restore QR from localStorage
     * Order view: polling & QR rendering (if server provided qrUrl or use localStorage)
     * Admin: dashboard charts, products/users DataTables + CRUD, WA login handlers
*/

(function($){
  "use strict";

  // small helper
  function money(v){ return Number(v||0).toLocaleString('id-ID'); }

  // safe element getter
  function $id(sel){ return document.getElementById(sel); }

  $(document).ready(function(){

    console.log("app.js loaded");

    // GLOBAL TOASTR DEFAULTS
    if (window.toastr) {
      toastr.options.closeButton = true;
      toastr.options.progressBar = true;
      toastr.options.positionClass = "toast-top-right";
    }

    // ---------- PUBLIC SPA: cart & order ----------
    // cart is array of { product_id, name, price, qty }
    const cart = [];

    function renderCart(){
      const $tb = $('#cartTbl tbody');
      if (!$tb.length) return;
      $tb.empty();
      let total = 0;
      cart.forEach((c,i)=>{
        const sub = c.qty * c.price;
        total += sub;
        const $tr = $(`
          <tr>
            <td class="align-middle">${escapeHtml(c.name)}</td>
            <td class="align-middle text-center">${c.qty}</td>
            <td class="align-middle">Rp ${money(c.price)}</td>
            <td class="align-middle">Rp ${money(sub)}</td>
            <td class="align-middle text-center"><button class="btn btn-sm btn-danger rem" data-i="${i}">Hapus</button></td>
          </tr>
        `);
        $tb.append($tr);
      });
      $('#totalAmount').text(money(total));
    }

    // escape for safe html injection
    function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }

    // Delegate add buttons (works for dynamic content)
    $(document).on('click', '.btn-add', function(e){
      e.preventDefault();
      const id = $(this).data('id');
      const name = $(this).data('name');
      const price = parseInt($(this).data('price'), 10) || 0;
      const qEl = $(`.qty-input[data-id="${id}"]`);
      const qty = Math.max(1, parseInt(qEl.val()||1,10));
      const ex = cart.find(x=>String(x.product_id) === String(id));
      if (ex) ex.qty += qty; else cart.push({ product_id: id, name, price, qty });
      renderCart();
      if (window.toastr) toastr.success('Ditambahkan ke keranjang');
    });

    // remove item
    $(document).on('click', '.rem', function(){
      const i = $(this).data('i');
      cart.splice(i,1);
      renderCart();
      if (window.toastr) toastr.info('Item dihapus');
    });

    // polling helper for order status (used by createOrder and restore)
    async function pollOrderStatus(orderId){
      if (!orderId) return;
      try {
        const res = await fetch('/o/status/' + encodeURIComponent(orderId));
        if (!res.ok) return;
        const j = await res.json();
        if (j.ok) {
          // update any present orderStatus element
          $('#orderStatus').text(j.status);
          // unify: treat non-pending as success
          if (j.status && j.status.toLowerCase() !== 'pending') {
            if (window.toastr) toastr.success('Pembayaran terkonfirmasi (' + j.status + ')');
            localStorage.removeItem('qr_' + orderId);
            const intervalName = 'poll_' + orderId;
            if (window[intervalName]) clearInterval(window[intervalName]);
          }
        }
      } catch(e) {
        console.warn('poll error', e);
      }
    }

    // Create order from cart (AJAX) - SPA behaviour
    $('#createOrder').on('click', async function(){
      if (!cart.length) { if (window.toastr) toastr.error('Keranjang kosong'); else alert('Keranjang kosong'); return; }

      const customer_name = ($('#custName').length ? $('#custName').val() : '') || '';
      const customer_phone = ($('#custPhone').length ? $('#custPhone').val() : '') || '';

      if (customer_phone && !/^(\+?62|0)8\d{7,12}$/.test(customer_phone)) {
        if (window.toastr) toastr.error('Format nomor WA tidak valid. Contoh: 08xxxx atau 628xxxx');
        else alert('Format nomor WA tidak valid. Contoh: 08xxxx atau 628xxxx');
        return;
      }

      const $btn = $(this);
      $btn.prop('disabled', true).text('Membuat...');

      try {
        const resp = await fetch('/order/create', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ items: cart, customer_name, customer_phone })
        });
        const data = await resp.json();
        if (!data.ok) {
          if (window.toastr) toastr.error(data.error || 'Gagal membuat order');
          else alert(data.error || 'Gagal membuat order');
          return;
        }

        // update UI: show QR and public link
        const qrUrl = data.qrUrl;
        const orderId = data.order_id;
        $('#orderLink').attr('href', '/o/' + orderId).text(window.location.origin + '/o/' + orderId);
        $('#orderStatus').text('PENDING');
        $('#qrWrap').show();

        if (qrUrl) {
          // render QR via QRCode lib (preferred) or display image
          try {
            $('#qrHolder').empty();
            const el = document.createElement('div');
            if (window.QRCode) {
              new QRCode(el, { text: qrUrl, width: 300, height: 300 });
            } else {
              // fallback: show image URL via QR generator service
              el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrUrl)}" alt="QRIS">`;
            }
            $('#qrHolder').append(el);
          } catch(e) {
            console.warn('QR render error', e);
            $('#qrHolder').html(`<img src="${qrUrl}" alt="QRIS" style="max-width:300px">`);
          }
        } else {
          // no QR URL returned, still show link to public order
          $('#qrHolder').html('<div class="text-muted">QR tidak tersedia. Silakan buka link order.</div>');
        }

        // persist to localStorage so user won't lose QR on refresh
        try { localStorage.setItem('qr_' + orderId, JSON.stringify({ qrUrl: qrUrl, created: Date.now() })); } catch(e){}

        // start polling every 5s
        const id = orderId;
        const intervalName = 'poll_' + id;
        if (window[intervalName]) clearInterval(window[intervalName]);
        window[intervalName] = setInterval(()=> pollOrderStatus(id), 5000);
        setTimeout(()=> pollOrderStatus(id), 3000);

        // clear cart after creating order (UX choice)
        cart.length = 0; renderCart();

        if (window.toastr) toastr.success('Order dibuat: ' + orderId);
      } catch (e) {
        console.error(e);
        if (window.toastr) toastr.error('Server error');
        else alert('Server error');
      } finally {
        $btn.prop('disabled', false).text('Buat Order & Tampilkan QRIS');
      }
    });

    // restore saved QR if user returns to site
    (function restoreSavedQr(){
      try {
        for (let i=0;i<localStorage.length;i++){
          const key = localStorage.key(i);
          if (!key) continue;
          if (key.startsWith('qr_')) {
            const data = JSON.parse(localStorage.getItem(key));
            if (data && data.qrUrl) {
              // show only if main page has qrHolder
              if ($('#qrHolder').length) {
                $('#qrHolder').empty();
                const el = document.createElement('div');
                if (window.QRCode) {
                  new QRCode(el, { text: data.qrUrl, width: 300, height: 300 });
                } else {
                  el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data.qrUrl)}">`;
                }
                $('#qrHolder').append(el);
                const orderId = key.replace('qr_','');
                $('#orderLink').attr('href','/o/' + orderId).text(window.location.origin + '/o/' + orderId);
                $('#qrWrap').show();
                $('#orderStatus').text('PENDING');
                window['poll_' + orderId] = setInterval(()=> pollOrderStatus(orderId), 5000);
              }
            }
          }
        }
      } catch(e){ console.warn('restore QR error', e); }
    })();

    // ---------- ORDER VIEW: render QR (server-provided) + polling ----------
    // If order_view page included a server variable qrUrl via a DOM element (#qrHolder data-qr)
    try {
      const $qrElem = $('#qrHolder');
      if ($qrElem.length && $qrElem.data('qr')) {
        // server injected data-qr attribute with qrUrl
        const suppliedQr = $qrElem.data('qr');
        $qrElem.empty();
        const el = document.createElement('div');
        if (window.QRCode) new QRCode(el, { text: suppliedQr, width: 300, height: 300 });
        else el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(suppliedQr)}">`;
        $qrElem.append(el);
      }
    } catch(e){ /* ignore */ }

    // If page has orderId element for polling (order_view.ejs uses variable order.order_id into JS)
    try {
      if (typeof orderId !== 'undefined' && orderId) {
        // orderId variable may be injected by view; start polling
        setInterval(()=> pollOrderStatus(orderId), 5000);
        pollOrderStatus(orderId);
      }
    } catch(e){ /* ignore */ }

    // ---------- ADMIN: Dashboard stats & Chart ----------
    if ($('#incomeChart').length) {
      async function loadDashboard(){
        try {
          const res = await fetch('/adm/api/dashboard-stats');
          if (!res.ok) throw new Error('Failed');
          const j = await res.json();
          $('#incomeNum').text(money(j.income || 0));
          $('#expenseNum').text(money(j.expense || 0));
          $('#ordersNum').text(j.orders || 0);
          const ctx = document.getElementById('incomeChart').getContext('2d');
          if (window._incomeChart) window._incomeChart.destroy();
          window._incomeChart = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: ['Pemasukan','Pengeluaran'],
              datasets: [{ label: 'Rupiah', data: [j.income || 0, j.expense || 0], backgroundColor: ['#198754', '#dc3545'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
          });
        } catch(e){ console.warn('dashboard error', e); }
      }
      loadDashboard();
      setInterval(loadDashboard, 10000);
    }

    // ---------- ADMIN: Products SPA (DataTables + CRUD) ----------
    if ($('#tblProducts').length) {
      const prodTable = $('#tblProducts').DataTable({
        processing: true,
        serverSide: true,
        responsive: true,
        ajax: { url: '/adm/api/products', type: 'POST' },
        columns: [
          { data: 'id' }, { data: 'sku' }, { data: 'name' }, { data: 'price', render: v => money(v) },
          { data: 'stock' }, { data: 'active', render: d => d==1 ? 'Ya' : 'Tidak' },
          { data: null, orderable: false, render: d => `<button class="btn btn-sm btn-primary edit" data-id="${d.id}">Edit</button>
            <button class="btn btn-sm btn-danger del" data-id="${d.id}">Hapus</button>` }
        ],
        pageLength: 10,
        lengthMenu: [10,25,50,100]
      });

      $('#btnNew').on('click', function(){
        $('#formProd')[0].reset();
        $('#prodId').val('');
        $('#active').prop('checked', true);
        new bootstrap.Modal(document.getElementById('modalProd')).show();
      });

      $('#formProd').on('submit', async function(e){
        e.preventDefault();
        const id = $('#prodId').val();
        const payload = {
          id,
          sku: $('#sku').val(),
          name: $('#name').val(),
          price: $('#price').val(),
          stock: $('#stock').val(),
          active: $('#active').is(':checked') ? 1 : 0
        };
        const url = id ? '/adm/api/products/update' : '/adm/api/products/create';
        try {
          const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          const j = await r.json();
          if (!j.ok) { toastr.error(j.error || 'Gagal'); return; }
          toastr.success('Tersimpan');
          bootstrap.Modal.getInstance(document.getElementById('modalProd')).hide();
          prodTable.ajax.reload(null, false);
        } catch(e){ toastr.error('Server error'); console.error(e); }
      });

      $('#tblProducts').on('click', '.edit', function(){
        const id = $(this).data('id');
        const row = prodTable.rows().data().toArray().find(r => r.id == id);
        if (!row) return toastr.error('Data tidak ditemukan');
        $('#prodId').val(row.id); $('#sku').val(row.sku); $('#name').val(row.name); $('#price').val(row.price); $('#stock').val(row.stock); $('#active').prop('checked', row.active==1);
        new bootstrap.Modal(document.getElementById('modalProd')).show();
      });

      $('#tblProducts').on('click', '.del', function(){
        const id = $(this).data('id');
        if (!confirm('Hapus produk ini?')) return;
        fetch('/adm/api/products/delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
          .then(r=>r.json()).then(j=>{ if (j.ok) { toastr.success('Terhapus'); prodTable.ajax.reload(null,false); } else toastr.error(j.error||'Gagal'); })
          .catch(()=>toastr.error('Server error'));
      });
    }

    // ---------- ADMIN: Users SPA ----------
    if ($('#tblUsers').length) {
      const userTable = $('#tblUsers').DataTable({
        processing:true, serverSide:true, responsive:true, ajax:{url:'/adm/api/users', type:'POST'},
        columns:[
          { data: 'id' }, { data: 'username' }, { data: 'role' }, { data: 'created_at' },
          { data: null, orderable:false, render: d => `<button class="btn btn-sm btn-primary editU" data-id="${d.id}">Edit</button> <button class="btn btn-sm btn-danger delU" data-id="${d.id}">Hapus</button>` }
        ]
      });

      $('#btnNewUser').on('click', function(){ $('#formUser')[0].reset(); $('#userId').val(''); new bootstrap.Modal(document.getElementById('modalUser')).show(); });

      $('#formUser').on('submit', async function(e){ e.preventDefault();
        const id = $('#userId').val();
        const payload = { id, username: $('#userUsername').val(), password: $('#userPassword').val(), role: $('#userRole').val() };
        const url = id ? '/adm/api/users/update' : '/adm/api/users/create';
        try {
          const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          const j = await r.json(); if (!j.ok) { toastr.error(j.error||'Gagal'); return; }
          toastr.success('Tersimpan'); bootstrap.Modal.getInstance(document.getElementById('modalUser')).hide(); userTable.ajax.reload(null,false);
        } catch(e){ toastr.error('Server error'); console.error(e); }
      });

      $('#tblUsers').on('click', '.editU', function(){
        const id = $(this).data('id'); const row = userTable.rows().data().toArray().find(r=>r.id==id); if (!row) return toastr.error('Data tidak ditemukan');
        $('#userId').val(row.id); $('#userUsername').val(row.username); $('#userRole').val(row.role); $('#userPassword').val(''); new bootstrap.Modal(document.getElementById('modalUser')).show();
      });

      $('#tblUsers').on('click', '.delU', function(){
        const id = $(this).data('id'); if (!confirm('Hapus user ini?')) return;
        fetch('/adm/api/users/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }).then(r=>r.json()).then(j=>{ if (j.ok) { toastr.success('Terhapus'); userTable.ajax.reload(null,false); } else toastr.error(j.error||'Gagal'); }).catch(()=>toastr.error('Server error'));
      });
    }

    // ---------- ADMIN: WA login handlers ----------
    $('#btnWaLogin').on('click', async function(){
      $('#waQrArea').html('Menyiapkan login WA...');
      try {
        const r = await fetch('/adm/wa/login');
        const j = await r.json();
        if (!j.ok) { $('#waQrArea').html(`<div class="alert alert-danger">${escapeHtml(j.error || 'Unknown')}</div>`); return; }
        if (j.qr) $('#waQrArea').html(`<img src="${j.qr}" style="max-width:260px" class="img-fluid rounded">`);
        else $('#waQrArea').html('<div class="alert alert-info">QR tidak tersedia</div>');
      } catch(e){ $('#waQrArea').html('<div class="alert alert-danger">Gagal</div>'); }
    });

    $('#btnWaCheck').on('click', async function(){
      try {
        const r = await fetch('/adm/wa/status'); const j = await r.json();
        $('#waStatus').text(j.ready ? 'WA connected' : 'WA not connected');
      } catch(e){ $('#waStatus').text('Error'); }
    });

    // small safety: if any uncaught error, show in console but keep buttons clickable
    window.addEventListener('error', function(e){ console.error('Uncaught error:', e.error || e.message || e); });

  }); // end ready

})(jQuery);
