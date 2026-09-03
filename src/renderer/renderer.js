const driveSelect = document.querySelector("#drive");
const systemSelect = document.querySelector("#system");
const destinationLabel = document.querySelector("#destination");
const log = document.querySelector("#log");
const status = document.querySelector("#drive-state");
const probeLabel = document.querySelector("#probe");
let drives = [];
let systems = [];
let destination = "";

function write(message) { log.textContent += `\n${message}`; log.scrollTop = log.scrollHeight; }
function selectedSystem() { return systems.find(system => system.shortName === systemSelect.value) || null; }
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
}
async function probeSelectedDrive() {
  const drive = drives[Number(driveSelect.value)];
  if (!drive) return;
  const probe = await window.loadPlay.probeDisc(drive);
  if (probe.system) systemSelect.value = probe.system.shortName;
  probeLabel.textContent = probe.evidence;
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
document.querySelector("#refresh").addEventListener("click", refreshDrives);
driveSelect.addEventListener("change", probeSelectedDrive);
systemSelect.addEventListener("change", () => { probeLabel.textContent = selectedSystem() ? "Using the selected system profile." : "No system profile selected. ISO master only."; updateFormatAvailability(); });
document.querySelector("#scan-tools").addEventListener("click", refreshTools);
document.querySelector("#choose-folder").addEventListener("click", async () => { destination = await window.loadPlay.chooseDestination() || destination; destinationLabel.textContent = destination || "Choose a library folder"; });
document.querySelector("#start").addEventListener("click", async () => {
  const drive = drives[Number(driveSelect.value)];
  if (!drive || !destination) return write("Choose a detected drive and destination folder before starting.");
  const format = document.querySelector("input[name=format]:checked").value;
  const result = await window.loadPlay.startJob({ drive, format, destination, title: document.querySelector("#title").value, system: selectedSystem() });
  write(result.message);
});
window.loadPlay.onJobOutput(write);
refreshSystems().then(refreshDrives); refreshTools();