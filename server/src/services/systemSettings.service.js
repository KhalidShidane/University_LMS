import SystemSetting from '../models/SystemSetting.js'

export async function loadSystemSettings() {
  return await SystemSetting.findOne({ key: 'global' }).lean() || new SystemSetting().toObject()
}
