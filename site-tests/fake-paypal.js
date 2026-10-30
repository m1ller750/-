// Stand-in for the PayPal JS SDK in browser tests: one button that runs createOrder → onApprove.
window.paypal = {
  Buttons(options) {
    return {
      render(target) {
        const host = typeof target === 'string' ? document.querySelector(target) : target;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fake-paypal-button';
        button.textContent = 'Pay with PayPal (test)';
        button.style.cssText = 'width:100%;height:46px;border:0;border-radius:23px;background:#ffc439;color:#003087;font-weight:800;cursor:pointer';
        button.addEventListener('click', async () => {
          const allowed = await options.onClick?.({}, { resolve: () => true, reject: () => false });
          if (allowed === false) return;
          try {
            const orderID = await options.createOrder();
            await options.onApprove({ orderID }, { restart: () => {} });
          } catch (error) {
            options.onError?.(error);
          }
        });
        host.append(button);
        return Promise.resolve();
      },
    };
  },
};
