// deviceInfo.js
// Thu thập thông tin phần cứng / hệ điều hành của máy để gửi lên backend khi đăng ký / heartbeat.

const os = require('os');
const si = require('systeminformation');
const { machineIdSync } = require('node-machine-id');

async function collectDeviceInfo() {
  const [osInfo, cpu, mem, diskLayout, networkInterfaces] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.mem(),
    si.diskLayout(),
    si.networkInterfaces(),
  ]);

  const primaryNic = networkInterfaces.find(
    (n) => !n.internal && n.ip4 && n.operstate === 'up'
  ) || networkInterfaces.find((n) => !n.internal && n.ip4);

  const totalDiskGb = diskLayout.reduce((sum, d) => sum + (d.size || 0), 0) / (1024 ** 3);

  return {
    hostname: os.hostname(),
    machine_id: machineIdSync(true), // id duy nhất của máy, ổn định qua các lần khởi động
    os_info: `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`,
    cpu_info: `${cpu.manufacturer} ${cpu.brand}`,
    ram_gb: Math.round((mem.total / (1024 ** 3)) * 10) / 10,
    disk_info: diskLayout.map((d) => `${d.name} ${Math.round((d.size || 0) / (1024 ** 3))}GB`).join(', ')
      || `${Math.round(totalDiskGb)}GB`,
    mac_address: primaryNic ? primaryNic.mac : null,
    ip_address: primaryNic ? primaryNic.ip4 : null,
  };
}

module.exports = { collectDeviceInfo };
