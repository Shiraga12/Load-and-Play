const driveSelect = document.querySelector("#drive");
const destinationLabel = document.querySelector("#destination");
const log = document.querySelector("#log");
const status = document.querySelector("#drive-state");
let drives = [];
let destination = "";

function write(message) { log.textContent += `\n${message}`; log.scrollTop = log.scrollHeight; }
async function refreshDrives() {
  drives = await window.loadPlay.scanDrives();
  driveSelect.innerHTML = drives.length ? drives.map((drive, index) => `<option value="${index}">${drive.letter}: - ${drive.name}${drive.mediaLoaded ? "" : " (no media detected)"}</option>`).join("") : "<option>No optical drives found</option>";
  status.innerHTML = `<span class="${drives.some(drive => drive.mediaLoaded) ? "active" : ""}"></span> ${drives.length ? `${drives.length} drive${drives.length === 1 ? "" : "s"} detected` : "No drive detected"}`;
}
async function refreshTools() {
  const tools = await window.loadPlay.scanTools();
  document.querySelector("#tool-list").innerHTML = tools.map(tool => `<li><span class="dot ${tool.available ? "available" : ""}"></span><div><b>${tool.name}</b><small>${tool.purpose}</small></div><em>${tool.available ? "READY" : "NOT FOUND"}</em></li>`).join("");
}
document.querySelector("#refresh").addEventListener("click", refreshDrives);
document.querySelector("#scan-tools").addEventListener("click", refreshTools);
document.querySelector("#choose-folder").addEventListener("click", async () => { destination = await window.loadPlay.chooseDestination() || destination; destinationLabel.textContent = destination || "Choose a library folder"; });
document.querySelector("#start").addEventListener("click", async () => {
  const drive = drives[Number(driveSelect.value)];
  if (!drive || !destination) return write("Choose a detected drive and destination folder before starting.");
  const format = document.querySelector("input[name=format]:checked").value;
  const result = await window.loadPlay.startJob({ drive, format, destination, title: document.querySelector("#title").value });
  write(result.message);
});
window.loadPlay.onJobOutput(write);
refreshDrives(); refreshTools();