//@ts-check
import { CharacteristicChange, HapStatusError, PlatformAccessory, Service } from 'homebridge';
import { Panel, DryContact, Motion, Light } from 'xfinityhome';
import { XfinityHomePlatform } from '../platform';
import fs from 'fs';
import path from 'path';

export default class Accessory {
  protected temperatureService?: Service;
  protected name: string;
  protected log: (type: 'info' | 'warn' | 'error' | 'debug' | 1 | 2 | 3 | 4, message: string, ...args: unknown[]) => void;
  protected StatusError: typeof HapStatusError;
  protected projectDir: string;
  protected logPath: string;
  protected generalLogPath: string;

  constructor(
    platform: XfinityHomePlatform,
    accessory: PlatformAccessory,
    device: Panel | DryContact | Motion | Light,
  ) {
    this.name = device.device.name || 'Panel';
    this.projectDir = path.join(platform.api.user.storagePath(), 'XfinityHome');
    this.logPath = path.join(this.projectDir, this.name + '.log');
    this.generalLogPath = path.join(this.projectDir, 'General.log');

    if (!fs.existsSync(this.projectDir)) {
      fs.mkdirSync(this.projectDir);
    }
    this.log = (type: 'info' | 'warn' | 'error' | 'debug' | 1 | 2 | 3 | 4, message: string, ...args: unknown[]) => {
      const date = new Date();
      const time = `${('0' + (date.getMonth() + 1)).slice(-2)}/${('0' + date.getDate()).slice(-2)}/${date.getFullYear()}, ` +
        `${('0' + (date.getHours() % 12)).slice(-2)}:${('0' + (date.getMinutes())).slice(-2)}:${('0' + (date.getSeconds())).slice(-2)} ` +
        `${date.getHours() > 12 ? 'PM' : 'AM'}`;

      //if (typeof type === 'number') {
      if (type < 4 || typeof type === 'string') {
        fs.appendFileSync(this.generalLogPath, `[${time}] ${this.name}: ${message} ${args.join(' ')}\n`);
      }
      fs.appendFileSync(this.logPath, `[${time}] ${message} ${args.join(' ')}\n`);
      if (typeof type === 'number') {
        platform.log[type](`${this.name}: ${message} `, ...args);
      } else if (type <= (platform.config.logLevel ?? 3)) {
        platform.log.info(`${this.name}: ${message} `, ...args);
      } else {
        platform.log.debug(`${this.name}: ${message} `, ...args);
      }
    };
    this.log(4, 'Server Started');
    this.StatusError = platform.api.hap.HapStatusError;

    platform.api.on('shutdown', () => {
      this.log(4, 'Server Stopped');
      accessory.context.logPath = this.logPath;
      accessory.context.device = device.device;
      accessory.context.refreshToken = device.xhome.refreshToken;
      platform.api.updatePlatformAccessories([accessory]);
    });

    // set accessory information
    accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, device.device.manufacturer)
      .setCharacteristic(platform.Characteristic.SerialNumber, (device as Motion).device.serialNumber ?? accessory.UUID)
      .setCharacteristic(platform.Characteristic.Model, device.device.model)
      .setCharacteristic(platform.Characteristic.Name, this.name)
      .setCharacteristic(platform.Characteristic.FirmwareRevision, device.device.firmwareVersion)
      .getCharacteristic(platform.Characteristic.Identify).on('set', () => {
        this.log('info', 'Identifying Device:\n', device.device);
        if (device.device.deviceType.startsWith('light')) {
          let mode = (device as Light).device.properties.isOn;
          const startMode = mode;
          const interval = setInterval(() => {
            (device as Light).set(!mode).catch(err => {
              this.log('error', 'Failed To Toggle Light With Error:\n', err.response.data);
            });
            mode = !mode;
          }, 750);
          setTimeout(() => {
            clearInterval(interval);
            (device as Light).set(startMode).catch(err => {
              this.log('error', 'Failed To Toggle Light With Error:\n', err.response.data);
            });
          }, 5000);
        }
      });

    if ((device.device.properties as { temperature?: number }).temperature && (platform.config.temperatureSensors ?? true)) {
      this.temperatureService = accessory.getService(platform.Service.TemperatureSensor);
      if (!this.temperatureService) {
        this.log('info', 'Enabling Temperature Support');
        this.temperatureService = accessory.addService(platform.Service.TemperatureSensor);
      }

      this.temperatureService.setCharacteristic(platform.Characteristic.Name, device.device.name + ' Temperature');

      this.temperatureService.getCharacteristic(platform.Characteristic.CurrentTemperature)
        .onGet((): number => {
          return (device as DryContact | Motion).device.properties.temperature / 100;
          /*return new Promise((resolve, reject) => {
            device.get().then(device => resolve(device.properties.temperature / 100)).catch(err => {
              this.log('error', 'Failed To Fetch Temperature With Error:\n', err.response.data);
              reject(new this.StatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE));
            });
          });*/
        })
        .setProps({
          minStep: 0.01,
        })
        .on('change', async (value: CharacteristicChange): Promise<void> => {
          if (value.newValue !== value.oldValue) {
            this.log(4, `Updating Temperature To ${value.newValue}°C`);
          }
        });
    }
  }
}
