// public/js/app.js
/* Single app.js for Public + Admin behaviour
   - Ensure this file is loaded last (after jQuery, Bootstrap, DataTables)
*/

(function($){
  "use strict";

  // small helper
  function money(v){ return Number(v||0).toLocaleString('id-ID'); }

  $(document).ready(function(){

    console.log("app.js loaded");

    // GLOBAL TOASTR DEFAULTS
    if (window.toastr) {
      toastr.options.closeButton = true;
      toastr.options.progressBar = true;
      toastr.options.positionClass = "toast-top-right";
    }

    // ---------- Public store: cart & order ----------
    const cart = [];

    function renderCart(){
      const $tb = $('#cartTbl tbody');
      if (!$tb.length) return;
      $tb.empty();
      let total = 0;
      cart.forEach((c,i)=>{
        const sub = c.qty * c.price;
        total += sub;
        const $tr = $(`<tr>
          <td>${c.name}</td>
          <td>${c.qty}</td>
          <td>Rp ${money(c.price)}</td>
          <td>Rp ${money(sub)}</td>
          <td><button class="btn btn-sm btn-danger rem" data-i="${i}">Hapus</button></td>
        </tr>`);
        $tb.append($tr);
      });
      $('#totalAmount').text(money(total));
    }

    // delegate add buttons
    $(document).on('click', '.btn-add', function(e){
      e.preventDefault();
      const id = $(this).data('id');
      const name = $(this).data('name');
      const price = parseInt($(this).data('price'), 10);
      const qEl = $(`.qty-input[data-id="${id}"]`);
      const qty = Math.max(1, parseInt(qEl.val()||1,10));
      const ex = cart.find(x=>x.product_id == id);
      if (ex) ex.qty += qty; else cart.push({ product_id: id, name, price, qty });
      renderCart();
      toastr.success('Ditambahkan ke keranjang');
    });

    // remove
    $(document).on('click', '.rem', function(){
      const i = $(this).data('i');
      cart.splice(i,1);
      renderCart();
      toastr.info('Item dihapus');
    });

    // polling helper for order status
    async function pollOrderStatus(orderId){
      if (!orderId) return;
      try {
        const res = await fetch('/o/status/' + encodeURIComponent(orderId));
        if (!res.ok) return;
        const j = await res.json();
        if (j.ok) {
          $('#orderStatus').text(j.status);
          if (j.status === 'PAID') {
            toastr.success('Pembayaran terkonfirmasi');
            localStorage.removeItem('qr_' + orderId);
            const intervalName = 'poll_' + orderId;
            if (window[intervalName]) clearInterval(window[intervalName]);
          }
        }
      } catch(e) {
        console.warn('poll error', e);
      }
    }

    // create order (public)
    $('#createOrder').on('click', async function(){
      if (!cart.length) { toastr.error('Keranjang kosong'); return; }
      const customer_name = $('#custName').val();
      const customer_phone = $('#custPhone').val();
      if (customer_phone && !/^(\+?62|0)8\d{7,12}$/.test(customer_phone)) {
        toastr.error('Format nomor WA tidak valid. Contoh: 08xxxx atau 628xxxx');
        return;
      }
      $(this).prop('disabled', true).text('Membuat...');
      try {
        const resp = await fetch('/order/create', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ items: cart, customer_name, customer_phone })
        });
        const data = await resp.json();
        if (!data.ok) { toastr.error(data.error || 'Gagal membuat order'); return; }
        // show QR (client-side)
        const qrUrl = data.qrUrl;
        if (!qrUrl) {
          toastr.info('QR tidak tersedia. Silakan buka halaman order publik.');
          $('#orderLink').attr('href', '/o/' + data.order_id).text(window.location.origin + '/o/' + data.order_id);
          $('#qrWrap').show();
        } else {
          $('#qrHolder').empty();
          const $el = document.createElement('div');
          new QRCode($el, { text: qrUrl, width: 300, height: 300 });
          $('#qrHolder').append($el);
          $('#orderLink').attr('href', '/o/' + data.order_id).text(window.location.origin + '/o/' + data.order_id);
          $('#qrWrap').show();
          $('#orderStatus').text('PENDING');
          // save to localStorage
          try { localStorage.setItem('qr_' + data.order_id, JSON.stringify({ qrUrl: qrUrl, created: Date.now() })); } catch(e){}
          // start polling every 5s
          const id = data.order_id;
          const intervalName = 'poll_' + id;
          window[intervalName] = setInterval(()=> pollOrderStatus(id), 5000);
          setTimeout(()=> pollOrderStatus(id), 3000);
        }
        toastr.success('Order dibuat');
      } catch (e) {
        console.error(e);
        toastr.error('Server error');
      } finally {
        $('#createOrder').prop('disabled', false).text('Buat Order & Tampilkan QRIS');
      }
    });

    // restore saved QR on load
    (function restoreSavedQr(){
      try {
        for (let i=0;i<localStorage.length;i++){
          const key = localStorage.key(i);
          if (!key) continue;
          if (key.startsWith('qr_')) {
            const data = JSON.parse(localStorage.getItem(key));
            if (data && data.qrUrl) {
              $('#qrHolder').empty();
              const $el = document.createElement('div');
              new QRCode($el, { text: data.qrUrl, width: 300, height: 300 });
              $('#qrHolder').append($el);
              const orderId = key.replace('qr_','');
              $('#orderLink').attr('href','/o/' + orderId).text(window.location.origin + '/o/' + orderId);
              $('#qrWrap').show();
              $('#orderStatus').text('PENDING');
              window['poll_' + orderId] = setInterval(()=> pollOrderStatus(orderId), 5000);
            }
          }
        }
      } catch(e){}
    })();

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
        if (!j.ok) { $('#waQrArea').html(`<div class="alert alert-danger">${j.error}</div>`); return; }
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

    // small safety: if any jQuery error occurs, show in console but keep buttons clickable
    window.addEventListener('error', function(e){ console.error('Uncaught error:', e.error || e.message || e); });

  }); // end ready

})(jQuery);
