// public/js/app.js
$(function(){
  // PUBLIC STORE
  const cart = [];
  function renderCart(){
    const $tb = $('#cartTbl tbody');
    if (!$tb.length) return;
    $tb.html('');
    let total = 0;
    cart.forEach((c,i)=>{
      const sub = c.qty * c.price;
      total += sub;
      $tb.append(`<tr><td>${c.name}</td><td>${c.qty}</td><td>Rp ${c.price.toLocaleString('id-ID')}</td><td>Rp ${sub.toLocaleString('id-ID')}</td><td><button class="btn btn-sm btn-danger rem" data-i="${i}">Hapus</button></td></tr>`);
    });
    $('#totalAmount').text(total.toLocaleString('id-ID'));
    $('.rem').click(function(){ cart.splice($(this).data('i'),1); renderCart(); toastr.info('Item dihapus'); });
  }

  $('.btn-add').click(function(){
    const id = $(this).data('id'), name = $(this).data('name'), price = parseInt($(this).data('price'),10);
    const qEl = $(`.qty-input[data-id="${id}"]`); const qty = Math.max(1, parseInt(qEl.val()||1,10));
    const ex = cart.find(x=>x.product_id==id);
    if (ex) ex.qty += qty; else cart.push({ product_id:id, name, price, qty });
    renderCart(); toastr.success('Ditambahkan ke keranjang');
  });

  async function pollOrderStatus(orderId){
    try {
      const res = await fetch('/o/status/' + encodeURIComponent(orderId));
      const j = await res.json();
      if (j.ok) {
        $('#orderStatus').text(j.status);
        if (j.status === 'PAID') {
          toastr.success('Pembayaran terkonfirmasi');
          localStorage.removeItem('qr_' + orderId);
          clearInterval(window['poll_' + orderId]);
        }
      }
    } catch(e){ console.warn('poll err', e); }
  }

  $('#createOrder').click(async function(){
    if (!cart.length) return toastr.error('Keranjang kosong');
    const customer_name = $('#custName').val();
    const customer_phone = $('#custPhone').val();
    if (customer_phone && !/^(\+?62|0)8\d{7,12}$/.test(customer_phone)) { toastr.error('Format nomor WA tidak valid.'); return; }
    const body = { items: cart, customer_name, customer_phone };
    try {
      const res = await fetch('/order/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) { toastr.error(data.error || 'Gagal'); return; }
      const qrUrl = data.qrUrl;
      if (!qrUrl) { toastr.info('QR tidak tersedia'); $('#orderLink').attr('href','/o/'+data.order_id).text(window.location.origin + '/o/' + data.order_id); $('#qrWrap').show(); return; }
      $('#qrHolder').html(''); const qel = document.createElement('div'); new QRCode(qel, { text: qrUrl, width:300, height:300 }); $('#qrHolder').append(qel);
      $('#orderLink').attr('href','/o/'+data.order_id).text(window.location.origin + '/o/' + data.order_id); $('#qrWrap').show(); $('#orderStatus').text('PENDING');
      localStorage.setItem('qr_' + data.order_id, JSON.stringify({ qrUrl: qrUrl, created: Date.now() }));
      const id = data.order_id; window['poll_' + id] = setInterval(()=> pollOrderStatus(id), 5000); setTimeout(()=> pollOrderStatus(id), 3000);
      toastr.success('Order dibuat. QR disimpan di browser, cek status otomatis.');
    } catch(e){ console.error(e); toastr.error('Server error'); }
  });

  // restore last saved QR
  (function restoreLastQr(){
    for (let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i); if (!key) continue;
      if (key.startsWith('qr_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key)); if (data && data.qrUrl) {
            $('#qrHolder').html(''); const qel = document.createElement('div'); new QRCode(qel, { text: data.qrUrl, width:300, height:300 }); $('#qrHolder').append(qel);
            const orderId = key.replace('qr_',''); $('#orderLink').attr('href','/o/'+orderId).text(window.location.origin + '/o/' + orderId); $('#qrWrap').show(); $('#orderStatus').text('PENDING');
            window['poll_' + orderId] = setInterval(()=> pollOrderStatus(orderId), 5000);
          }
        } catch(e){}
      }
    }
  })();

  // ADMIN PAGES: Most code inline in views; leave DataTables init points here if needed

});
