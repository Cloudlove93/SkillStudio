const statusEl = document.querySelector("#status");
const threadsEl = document.querySelector("#threads");
const form = document.querySelector("#create-form");
const packageIdInput = document.querySelector("#package-id");
const titleInput = document.querySelector("#title");
const refreshButton = document.querySelector("#refresh");

function setStatus(text, state = "idle") {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function renderThreads(threads) {
  threadsEl.replaceChildren();
  if (threads.length === 0) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "No threads for this package.";
    threadsEl.append(item);
    return;
  }

  for (const thread of threads) {
    const item = document.createElement("li");
    item.innerHTML = `
      <strong></strong>
      <span></span>
      <code></code>
    `;
    item.querySelector("strong").textContent = thread.title;
    item.querySelector("span").textContent = new Date(thread.createdAt).toLocaleString();
    item.querySelector("code").textContent = `${thread.id} / ${thread.packageId}`;
    threadsEl.append(item);
  }
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function loadThreads() {
  const packageId = packageIdInput.value.trim();
  setStatus("Loading", "loading");
  try {
    const threads = await requestJson(`/api/threads?packageId=${encodeURIComponent(packageId)}`);
    renderThreads(threads);
    setStatus("Loaded", "ok");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Load failed", "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Creating", "loading");
  try {
    await requestJson("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packageId: packageIdInput.value,
        title: titleInput.value,
      }),
    });
    await loadThreads();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Create failed", "error");
  }
});

refreshButton.addEventListener("click", loadThreads);
packageIdInput.addEventListener("change", loadThreads);

loadThreads();
