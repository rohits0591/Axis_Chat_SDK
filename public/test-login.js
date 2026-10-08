/* ============================================================
   TEST-ONLY LOGIN — one hardcoded customer, no backend/database.
   Purpose: let chat-widget.js pick up a real "logged-in customer ID"
   (see ICDeviceProfile's customerId field) so its presence can be
   verified directly in Webex Connect Flow Builder's transaction logs.

   Not representative of how ASL's real site will authenticate —
   this only exists to produce a realistic customerId for QA.
   ============================================================ */

(function () {
  var TEST_USER = {
    customerId: "AXS100234",
    name: "Rohit Sharma",
  };

  var STORAGE_KEY_ID = "axis_test_customer_id";
  var STORAGE_KEY_NAME = "axis_test_customer_name";

  function getLoggedInCustomer() {
    var id = localStorage.getItem(STORAGE_KEY_ID);
    var name = localStorage.getItem(STORAGE_KEY_NAME);
    return id ? { customerId: id, name: name } : null;
  }

  function setLoggedInCustomer(user) {
    localStorage.setItem(STORAGE_KEY_ID, user.customerId);
    localStorage.setItem(STORAGE_KEY_NAME, user.name);
    document.dispatchEvent(new CustomEvent("axis:login", { detail: user }));
  }

  function clearLoggedInCustomer() {
    localStorage.removeItem(STORAGE_KEY_ID);
    localStorage.removeItem(STORAGE_KEY_NAME);
    document.dispatchEvent(new CustomEvent("axis:logout"));
  }

  function renderState() {
    var loginBtn = document.getElementById("test-login-btn");
    var statusEl = document.getElementById("test-login-status");
    var nameEl = document.getElementById("test-login-name");
    var current = getLoggedInCustomer();

    if (current) {
      loginBtn.hidden = true;
      statusEl.hidden = false;
      nameEl.textContent = "Hi, " + current.name.split(" ")[0] + " (" + current.customerId + ")";
    } else {
      loginBtn.hidden = false;
      statusEl.hidden = true;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var loginBtn = document.getElementById("test-login-btn");
    var logoutBtn = document.getElementById("test-logout-btn");

    loginBtn.addEventListener("click", function () {
      setLoggedInCustomer(TEST_USER);
      renderState();
    });
    logoutBtn.addEventListener("click", function () {
      clearLoggedInCustomer();
      renderState();
    });

    renderState();
  });

  // Exposed so chat-widget.js can read the logged-in customer at the
  // moment it registers, without caring how login is actually implemented.
  window.AxisTestAuth = { getLoggedInCustomer: getLoggedInCustomer };
})();
