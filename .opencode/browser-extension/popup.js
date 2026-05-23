async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}
function el(id) { return document.getElementById(id); }
async function refresh() {
  const resp = await send({ type: "GET_STATUS" });
  if (resp?.settings) {
    el("host").value = resp.settings.host || "127.0.0.1";
    el("port").value = resp.settings.port || 37987;
  }
  el("status").textContent = JSON.stringify(resp, null, 2);
}
el("start").addEventListener("click", async () => {
  const resp = await send({ type: "START", host: el("host").value, port: Number(el("port").value), token: el("token").value });
  el("status").textContent = JSON.stringify(resp, null, 2);
  setTimeout(refresh, 500);
});
el("stop").addEventListener("click", async () => {
  const resp = await send({ type: "STOP" });
  el("status").textContent = JSON.stringify(resp, null, 2);
  setTimeout(refresh, 500);
});
refresh();
setInterval(refresh, 3000);
