// Stand-in for the PayPal JS SDK while recording the demo video (the container cannot reach paypal.com).
// It looks and behaves like the Smart Payment Buttons: PayPal + "Debit or Credit Card" with inline card fields,
// and runs the same createOrder → onApprove callbacks as the real SDK.
(() => {
  const css = `
  .pp-wrap{font-family:"Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;gap:10px}
  .pp-btn{height:46px;border:0;border-radius:23px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-size:16px;font-weight:700;width:100%;transition:filter .15s}
  .pp-btn:hover{filter:brightness(.96)}
  .pp-gold{background:#ffc439;color:#003087}
  .pp-black{background:#2c2e2f;color:#fff}
  .pp-logo{font-style:italic;font-weight:800;font-size:21px;letter-spacing:-.5px}
  .pp-logo b{color:#003087}.pp-logo i{color:#009cde;font-style:italic}
  .pp-card-ico{width:30px;height:20px;border-radius:3px;background:linear-gradient(135deg,#fff 0,#dfe3e8 100%);position:relative}
  .pp-card-ico:after{content:"";position:absolute;left:3px;right:3px;top:5px;height:3px;background:#2c2e2f}
  .pp-powered{text-align:center;color:#6c7378;font-size:12px}.pp-powered b{font-style:italic;color:#003087}
  .pp-form{display:none;flex-direction:column;gap:10px;padding:14px;border:1px solid #cbd2d6;border-radius:12px;background:#fff;color:#2c2e2f;animation:ppIn .35s ease}
  .pp-form.on{display:flex}
  @keyframes ppIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
  .pp-form h4{margin:0;font:700 15px "Helvetica Neue",Arial,sans-serif;color:#2c2e2f}
  .pp-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .pp-field{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#6c7378}
  .pp-field input{height:40px;border:1px solid #9da3a6;border-radius:6px;padding:0 10px;font:16px "Helvetica Neue",Arial,sans-serif;color:#2c2e2f;background:#fff;outline:none}
  .pp-field input:focus{border-color:#0070ba;box-shadow:0 0 0 2px rgba(0,112,186,.25)}
  .pp-pay{background:#0070ba;color:#fff;margin-top:4px}
  .pp-note{font-size:11.5px;color:#6c7378;text-align:center}
  .pp-spin{width:18px;height:18px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:ppSpin .8s linear infinite}
  @keyframes ppSpin{to{transform:rotate(360deg)}}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  window.paypal = {
    Buttons(options) {
      return {
        render(target) {
          const host = typeof target === 'string' ? document.querySelector(target) : target;
          const wrap = document.createElement('div');
          wrap.className = 'pp-wrap';
          wrap.innerHTML = `
            <button type="button" class="pp-btn pp-gold" data-pp-paypal><span class="pp-logo"><b>Pay</b><i>Pal</i></span></button>
            <button type="button" class="pp-btn pp-black" data-pp-card><span class="pp-card-ico"></span> Debit or Credit Card</button>
            <div class="pp-form" data-pp-form>
              <h4>Pay with debit or credit card</h4>
              <label class="pp-field">Card number<input data-pp-number inputmode="numeric" autocomplete="off"></label>
              <div class="pp-row">
                <label class="pp-field">Expires<input data-pp-exp placeholder="MM/YY" autocomplete="off"></label>
                <label class="pp-field">CSC<input data-pp-csc autocomplete="off"></label>
              </div>
              <button type="button" class="pp-btn pp-pay" data-pp-pay>Pay Now</button>
              <div class="pp-note">PayPal sandbox · test card, no real money</div>
            </div>
            <div class="pp-powered">Powered by <b>PayPal</b></div>`;
          host.append(wrap);
          const form = wrap.querySelector('[data-pp-form]');
          const start = async () => {
            const allowed = await options.onClick?.({}, { resolve: () => true, reject: () => false });
            return allowed !== false;
          };
          wrap.querySelector('[data-pp-card]').addEventListener('click', async () => {
            if (!(await start())) return;
            form.classList.add('on');
            wrap.querySelector('[data-pp-card]').style.display = 'none';
            wrap.querySelector('[data-pp-paypal]').style.display = 'none';
            form.querySelector('[data-pp-number]').focus();
          });
          const number = wrap.querySelector('[data-pp-number]');
          number.addEventListener('input', () => {
            const digits = number.value.replace(/\D/g, '').slice(0, 16);
            number.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
          });
          const pay = wrap.querySelector('[data-pp-pay]');
          pay.addEventListener('click', async () => {
            pay.disabled = true;
            pay.innerHTML = '<span class="pp-spin"></span>';
            try {
              const orderID = await options.createOrder();
              await new Promise((r) => setTimeout(r, 500));
              form.classList.remove('on');
              wrap.querySelector('.pp-powered').innerHTML = `Order <b>${orderID}</b> approved`;
              await options.onApprove({ orderID }, { restart: () => {} });
            } catch (error) {
              pay.disabled = false; pay.textContent = 'Pay Now';
              options.onError?.(error);
            }
          });
          wrap.querySelector('[data-pp-paypal]').addEventListener('click', async () => {
            if (!(await start())) return;
            const orderID = await options.createOrder();
            await options.onApprove({ orderID }, { restart: () => {} });
          });
          return Promise.resolve();
        },
      };
    },
  };
})();
