document.querySelectorAll(".btn[data-url]").forEach(btn => {
  btn.addEventListener("click", () => {
    chrome.tabs.create({ url: btn.dataset.url });
    window.close();
  });
});
