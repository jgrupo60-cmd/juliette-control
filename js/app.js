(() => {
  const button = document.getElementById("startServerButton");
  const toast = document.getElementById("toast");
  const checked = document.getElementById("lastChecked");
  document.getElementById("year").textContent = `© ${new Date().getFullYear()}`;

  button.addEventListener("click", () => {
    checked.textContent = new Intl.DateTimeFormat("es-CL", {
      hour: "2-digit", minute: "2-digit"
    }).format(new Date());
    toast.classList.add("show");
    clearTimeout(window.julietteToast);
    window.julietteToast = setTimeout(() => toast.classList.remove("show"), 3200);
  });
})();
