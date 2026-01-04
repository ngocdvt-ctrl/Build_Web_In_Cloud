// public/script.js
document.addEventListener("DOMContentLoaded", () => {
  const registerBtn = document.querySelector(".btn-register");
  const loginBtn = document.querySelector(".btn-login");

  const emailInput = document.getElementById("username"); // UI đang đặt là username nhưng dùng như email
  const passInput = document.getElementById("password");

  // Register: chuyển sang trang register flow của anh
  registerBtn?.addEventListener("click", () => {
    window.location.href = "register.html";
  });

  // Login
  loginBtn?.addEventListener("click", async () => {
    const email = (emailInput?.value || "").trim();
    const password = passInput?.value || "";

    if (!email || !password) {
      alert("メールアドレスとパスワードを入力してください");
      return;
    }

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include", // ✅ BẮT BUỘC để browser lưu cookie httpOnly
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // Login OK -> vào dashboard protected
        window.location.href = "dashboard.html";
        return;
      }

      alert(data.message || "ログインに失敗しました");
    } catch (e) {
      console.error(e);
      alert("ネットワークエラーが発生しました");
    }
  });
});
