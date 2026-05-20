const statusEl = document.querySelector("#status");
const eventsEl = document.querySelector("#events");
const connectButton = document.querySelector("#connect");
const disconnectButton = document.querySelector("#disconnect");
const clearButton = document.querySelector("#clear");

let source = null;

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function appendEvent(type, payload) {
  //   payload
  // {count: 258, at: '2026-05-20T12:54:27.457Z'}
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  item.innerHTML = `<span>${time}</span><strong>${type}</strong><code></code>`;
  item.querySelector("code").textContent = JSON.stringify(payload);
  eventsEl.prepend(item);
}

function connect() {
  if (source) return;

  source = new EventSource("/events");
  setStatus("Connecting", "connecting");

  source.addEventListener("open", () => {
    setStatus("Connected", "connected");
  });

  source.addEventListener("ready", (event) => {
    appendEvent("ready", JSON.parse(event.data));
  });

  source.addEventListener("tick", (event) => {
    appendEvent("tick", JSON.parse(event.data));
  });

  source.addEventListener("error", () => {
    setStatus("Reconnecting", "connecting");
  });
}

function disconnect() {
  if (!source) return;
  source.close();
  source = null;
  setStatus("Disconnected", "disconnected");
}

connectButton.addEventListener("click", connect);
disconnectButton.addEventListener("click", disconnect);
clearButton.addEventListener("click", () => {
  eventsEl.replaceChildren();
});

connect();
