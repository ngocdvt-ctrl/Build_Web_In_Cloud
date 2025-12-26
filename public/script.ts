document.addEventListener('DOMContentLoaded', () => {
    const registerBtn = document.querySelector('.btn-register');
    const loginBtn = document.querySelector('.btn-login');
    const idInput = document.getElementById('username');
    const passInput = document.getElementById('password');

    // --- Xử lý Đăng ký ---
    registerBtn?.addEventListener('click', async () => {
        const username = idInput.value;
        const password = passInput.value;

        if (!username || !password) {
            alert('ID và mật khẩu không được để trống!');
            return;
        }

        try {
            const response = await fetch('/api/server', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'register', // Gửi tín hiệu đăng ký
                    username: username, 
                    password: password 
                }),
            });

            const result = await response.json();
            if (response.ok) {
                alert(result.message);
                idInput.value = '';
                passInput.value = '';
            } else {
                alert('Lỗi: ' + result.error);
            }
        } catch (error) {
            alert('Không thể kết nối đến máy chủ.');
        }
    });

    // --- Xử lý Đăng nhập (Chuyển trang trực tiếp) ---
    loginBtn?.addEventListener('click', async () => {
        const username = idInput.value;
        const password = passInput.value;

        const response = await fetch('/api/server', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', username, password })
        });

        if (response.ok) {
            window.location.href = 'member.html'; // Chuyển trang ngay khi thành công
        } else {
            const result = await response.json();
            alert('Lỗi đăng nhập: ' + result.error);
        }
    });
});