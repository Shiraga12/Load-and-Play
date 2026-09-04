const driveSelect = document.querySelector("#drive");
const systemSelect = document.querySelector("#system");
const destinationLabel = document.querySelector("#destination");
const log = document.querySelector("#log");
const status = document.querySelector("#drive-state");
const probeLabel = document.querySelector("#probe");
const titleInput = document.querySelector("#title");
const metadataProvider = document.querySelector("#metadata-provider");
const metadataCredentials = document.querySelector("#metadata-credentials");
const metadataStatus = document.querySelector("#metadata-status");
const metadataResults = document.querySelector("#metadata-results");
const systemArtwork = document.querySelector("#system-artwork");
const systemGrid = document.querySelector("#system-grid");
const systemLogo = document.querySelector("#system-logo");
const systemArtworkName = document.querySelector("#system-artwork-name");
const libraryPath = document.querySelector("#library-path");
const libraryFilter = document.querySelector("#library-filter");
const libraryList = document.querySelector("#library-list");
let drives = [];
let systems = [];
let destination = "";
let detectedMetadata = null;
let libraryRoot = "";
let libraryItems = [];
const credentialFields = {
  screenscraper: [
    ["username", "Account username", "text"],
    ["password", "Account password", "password"],
    ["developerId", "Developer ID", "text"],
    ["developerPassword", "Developer password", "password"]
  ],
  launchbox: [["endpoint", "API URL", "url"], ["apiKey", "API key", "password"]],
  mobygames: [["apiKey", "ScraperAPI key", "password"]],
  steamgriddb: [["apiKey", "SteamGridDB API key", "password"]]
};

function write(message) { log.textContent += `\n${message}`; log.scrollTop = log.scrollHeight; }
function renderCredentialFields() {
  metadataCredentials.replaceChildren();
  credentialFields[metadataProvider.value].forEach(([name, labelText, type]) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.name = name;
    input.type = type;
    input.autocomplete = "off";
    input.spellcheck = false;
    label.append(input);
    metadataCredentials.append(label);
  });
}
function lookupCredentials() {
  return Object.fromEntries(Array.from(metadataCredentials.querySelectorAll("input")).map(input => [input.name, input.value]));
}
function selectedSystem() { return systems.find(system => system.shortName === systemSelect.value) || null; }
function updateSystemArtwork() {
  const system = selectedSystem();
  systemArtwork.hidden = !system;
  if (!system) return;
  const name = encodeURIComponent(system.shortName);
  systemArtwork.classList.remove("without-grid");
  systemGrid.hidden = false;
  systemLogo.hidden = false;
  systemGrid.src = `../../systems/images/grids/${name}.png`;
  systemLogo.src = `../../systems/images/logos/${name}.png`;
  systemLogo.alt = `${system.name} logo`;
  systemArtworkName.textContent = system.name;
}
systemGrid.addEventListener("error", () => { systemGrid.hidden = true; systemArtwork.classList.add("without-grid"); });
systemLogo.addEventListener("error", () => { systemLogo.hidden = true; });
function updateFormatAvailability() {
  const system = selectedSystem();
  document.querySelectorAll("input[name=format]").forEach(input => {
    const supported = input.value === "iso" || (input.value === "chd" ? Boolean(system?.fileFormats.includes(".chd") && system.media.some(medium => /DVD/i.test(medium))) : Boolean(system?.fileFormats.includes(`.${input.value}`)));
    input.disabled = !supported;
    if (!supported && input.checked) document.querySelector("input[name=format][value=iso]").checked = true;
  });
}
async function refreshSystems() {
  systems = await window.loadPlay.listSystems();
  systemSelect.innerHTML = `<option value="">Unknown / choose manually</option>${systems.map(system => `<option value="${system.shortName}">${system.name}</option>`).join("")}`;
  updateFormatAvailability();
  updateSystemArtwork();
}
async function probeSelectedDrive() {
  const drive = drives[Number(driveSelect.value)];
  if (!drive) return;
  const probe = await window.loadPlay.probeDisc(drive);
  if (probe.system) systemSelect.value = probe.system.shortName;
  detectedMetadata = probe.metadata;
  if (probe.metadata.title && (!titleInput.value || titleInput.value === "untitled-disc")) titleInput.value = probe.metadata.title;
  probeLabel.textContent = probe.evidence;
  metadataStatus.textContent = probe.metadata.gameId ? `Detected ${probe.metadata.gameId} (${probe.metadata.region}).` : probe.metadata.volumeLabel ? `Detected volume: ${probe.metadata.volumeLabel}.` : "No local game metadata found.";
  updateFormatAvailability();
}
async function refreshDrives() {
  drives = await window.loadPlay.scanDrives();
  driveSelect.innerHTML = drives.length ? drives.map((drive, index) => `<option value="${index}">${drive.letter}: - ${drive.name}${drive.mediaLoaded ? "" : " (no media detected)"}</option>`).join("") : "<option>No optical drives found</option>";
  status.innerHTML = `<span class="${drives.some(drive => drive.mediaLoaded) ? "active" : ""}"></span> ${drives.length ? `${drives.length} drive${drives.length === 1 ? "" : "s"} detected` : "No drive detected"}`;
  await probeSelectedDrive();
}
async function refreshTools() {
  const tools = await window.loadPlay.scanTools();
  document.querySelector("#tool-list").innerHTML = tools.map(tool => `<li><span class="dot ${tool.available ? "available" : ""}"></span><div><b>${tool.name}</b><small>${tool.purpose}</small></div><em>${tool.available ? "READY" : "NOT FOUND"}</em></li>`).join("");
}
async function lookupMetadata() {
  metadataStatus.textContent = "Searching game metadata...";
  metadataResults.replaceChildren();
  const lookup = await window.loadPlay.lookupMetadata(metadataProvider.value, titleInput.value, lookupCredentials());
  metadataStatus.textContent = lookup.message || "Choose a matching title.";
  lookup.results.forEach(result => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = result.title;
    button.title = result.url;
    button.addEventListener("click", () => {
      titleInput.value = result.title;
      detectedMetadata = detectedMetadata || { title: null, gameId: null, region: null, volumeLabel: null, fileSystem: null, sizeBytes: null, external: null };
      detectedMetadata.external = { provider: result.provider, id: result.id, title: result.title, url: result.url };
      metadataStatus.textContent = `Title selected from ${result.provider} metadata.`;
      metadataResults.replaceChildren();
    });
    item.append(button);
    metadataResults.append(item);
  });
}
function renderLibrary() {
  const query = libraryFilter.value.trim().toLowerCase();
  const items = libraryItems.filter(item => !query || `${item.title} ${item.platform}`.toLowerCase().includes(query));
  libraryList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty-library";
    empty.textContent = libraryRoot ? "No matching capture records found." : "No library selected.";
    libraryList.append(empty);
    return;
  }
  items.forEach(item => {
    const row = document.createElement("li");
    const details = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = item.title;
    const description = document.createElement("small");
    description.textContent = `${item.platform} · ${item.format.toUpperCase()} · ${item.localStatus}`;
    details.append(title, description);
    const verify = document.createElement("button");
    verify.type = "button";
    verify.className = "text-button";
    verify.textContent = "Verify";
    verify.addEventListener("click", async () => {
      verify.disabled = true;
      verify.textContent = "Checking...";
      try {
        const result = await window.loadPlay.verifyLibraryItem(libraryRoot, item.manifestPath);
        item.localStatus = result.status;
        renderLibrary();
        write(`${item.title}: ${result.message}`);
      } catch (error) {
        write(`Could not verify ${item.title}: ${error.message || error}`);
        verify.disabled = false;
        verify.textContent = "Verify";
      }
    });
    row.append(details, verify);
    libraryList.append(row);
  });
}
async function chooseLibrary() {
  const selected = await window.loadPlay.chooseDestination();
  if (!selected) return;
  libraryRoot = selected;
  libraryPath.textContent = "Loading capture records...";
  libraryItems = await window.loadPlay.listLibrary(libraryRoot);
  libraryPath.textContent = libraryItems.length ? `${libraryItems.length} capture record${libraryItems.length === 1 ? "" : "s"} in ${libraryRoot}` : `No capture records found in ${libraryRoot}`;
  renderLibrary();
}
document.querySelector("#refresh").addEventListener("click", refreshDrives);
driveSelect.addEventListener("change", probeSelectedDrive);
systemSelect.addEventListener("change", () => { probeLabel.textContent = selectedSystem() ? "Using the selected system profile." : "No system profile selected. ISO master only."; updateFormatAvailability(); updateSystemArtwork(); });
document.querySelector("#scan-tools").addEventListener("click", refreshTools);
metadataProvider.addEventListener("change", () => { renderCredentialFields(); metadataResults.replaceChildren(); metadataStatus.textContent = "Credentials are used only for this lookup."; });
document.querySelector("#lookup-metadata").addEventListener("click", lookupMetadata);
document.querySelector("#choose-folder").addEventListener("click", async () => { destination = await window.loadPlay.chooseDestination() || destination; destinationLabel.textContent = destination || "Choose a library folder"; });
document.querySelector("#choose-library").addEventListener("click", chooseLibrary);
libraryFilter.addEventListener("input", renderLibrary);
document.querySelector("#start").addEventListener("click", async () => {
  const drive = drives[Number(driveSelect.value)];
  if (!drive || !destination) return write("Choose a detected drive and destination folder before starting.");
  const format = document.querySelector("input[name=format]:checked").value;
  const result = await window.loadPlay.startJob({ drive, format, destination, title: titleInput.value, system: selectedSystem(), metadata: detectedMetadata });
  write(result.message);
});
window.loadPlay.onJobOutput(write);
renderCredentialFields();
refreshSystems().then(refreshDrives); refreshTools();