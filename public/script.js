// public/script.js
// Vai trò:
// - Xử lý UI + điều hướng cho trang public (index.html)
// - Session-aware header (ログイン ↔ マイページ + hover ログアウト)
// - Không chứa logic auth (auth ở backend + cookie)

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    bindPublicButtons();
    initHeaderAuth(); // chỉ chạy nếu page có header-auth-slot
  });

  // ==============================
  // Public buttons (nếu có)
  // ==============================
  function bindPublicButtons() {
    const registerBtn = document.querySelector(".btn-register");
    const loginBtn = document.querySelector(".btn-login");

    // Register → sang trang đăng ký
    registerBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      location.href = "register.html";
    });

    // Login → sang trang đăng nhập
    loginBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      location.href = "login.html";
    });
  }

  // ==============================
  // Header auth state (index page)
  // - /api/me 200 => logged in => マイページ + enable hover logout
  // - else => ログイン
  // ==============================
  async function initHeaderAuth() {
    const slot = document.getElementById("header-auth-slot");
    if (!slot) return; // page không có header auth

    const menu = document.getElementById("auth-menu");
    const mainBtn = document.getElementById("auth-main-btn");
    const logoutBtn = document.getElementById("auth-logout-btn"); // ✅ optional

    // Nếu HTML thiếu phần nào đó, vẫn show slot để khỏi "mất nút"
    if (!menu || !mainBtn) {
      slot.style.visibility = "visible";
      return;
    }

    // Tạm ẩn logout button cho chắc (tránh hiện sai trước khi check)
    if (logoutBtn) {
      logoutBtn.style.display = "none";
      logoutBtn.setAttribute("aria-hidden", "true");
    }

    try {
      const loggedIn = await isLoggedIn();

      if (loggedIn) {
        setLoggedInUI(mainBtn, menu, logoutBtn);
      } else {
        setLoggedOutUI(mainBtn, menu, logoutBtn);
      }
    } catch (err) {
      // Network fallback -> treat as logged out
      console.error("initHeaderAuth failed:", err);
      setLoggedOutUI(mainBtn, menu, logoutBtn);
    } finally {
      // prevent flicker
      slot.style.visibility = "visible";
    }
  }

  async function isLoggedIn() {
    const res = await fetch("/api/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    return res.ok;
  }

  function setLoggedInUI(mainBtn, menu, logoutBtn) {
    mainBtn.textContent = "マイページ";
    mainBtn.href = "dashboard.html";
    menu.classList.add("is-logged-in");

    // ✅ Hover logout (nếu có nút logout trong HTML)
    if (logoutBtn) {
      logoutBtn.style.display = "inline-flex";
      logoutBtn.removeAttribute("aria-hidden");

      // bind click 1 lần
      if (!logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          await logoutAndGoHome();
        });
      }

      // ESC để đóng dropdown (nếu anh dùng CSS hover thì vẫn ok)
      menu.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          mainBtn.blur();
          logoutBtn.blur();
        }
      });
    }
  }

  function setLoggedOutUI(mainBtn, menu, logoutBtn) {
    mainBtn.textContent = "ログイン";
    mainBtn.href = "login.html";
    menu.classList.remove("is-logged-in");

    if (logoutBtn) {
      logoutBtn.style.display = "none";
      logoutBtn.setAttribute("aria-hidden", "true");
    }
  }

  // ==============================
  // Logout (export global for onclick fallback)
  // ==============================
  async function logoutAndGoHome() {
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch (e) {
      console.error("Logout failed:", e);
    } finally {
      // replace để tránh back quay lại trạng thái cũ
      location.replace("index.html");
    }
  }

  // ✅ Cho trường hợp index.html vẫn gọi onclick="logoutFromIndex()"
  window.logoutFromIndex = logoutAndGoHome;
})();
