/* ==============================
   Auth Utility (Lv3)
   - Session based (httpOnly cookie)
   - Used by dashboard / protected pages
============================== */

/* ==============================
   Check login status
============================== */
async function checkAuth() {
  try {
    const response = await fetch("/api/me", {
      method: "GET",
      credentials: "include" // ⭐ VERY IMPORTANT
    });

    if (!response.ok) {
      // Not logged in
      redirectToLogin();
      return null;
    }

    const user = await response.json();
    return user; // { id, email, name, ... }

  } catch (err) {
    console.error("Auth check failed:", err);
    redirectToLogin();
    return null;
  }
}

/* ==============================
   Logout
============================== */
async function logout() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include"
    });
  } catch (err) {
    console.error("Logout error:", err);
  } finally {
    redirectToLogin();
  }
}

/* ==============================
   Redirect helpers
============================== */
function redirectToLogin() {
  location.href = "login.html";
}

/* ==============================
   Protect page helper
   Usage:
     protectPage(async (user) => {
       console.log(user);
     });
============================== */
async function protectPage(callback) {
  const user = await checkAuth();
  if (!user) return;
  if (typeof callback === "function") {
    await callback(user);
  }
}
