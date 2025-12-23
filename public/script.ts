const registerBtn = document.querySelector('.register-btn');

registerBtn?.addEventListener('click', async () => {
  const idInput = (document.getElementById('id') as HTMLInputElement).value;
  const passInput = (document.getElementById('password') as HTMLInputElement).value;

  // Gửi dữ liệu lên Backend Node.js trên Vercel
  const response = await fetch('/api/server', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: idInput, password: passInput })
  });

  const data = await response.json();
  alert(data.message);
});