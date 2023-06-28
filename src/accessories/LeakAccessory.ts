import { CharacteristicChange, CharacteristicValue, HAPStatus, PlatformAccessory, Service } from 'homebridge';
import { Water } from 'xfinityhome';

import { XfinityHomePlatform } from '../platform';
import { CONTEXT } from '../settings';
import Accessory from './Accessory';


export default class LeakAccessory extends Accessory {
  protected temperatureService?: Service;

  constructor(
    private readonly platform: XfinityHomePlatform,
    private readonly accessory: PlatformAccessory<CONTEXT>,
    private readonly device: Water,
  ) {
    super(platform, accessory, device, accessory.getService(platform.Service.LeakSensor) ||
      accessory.addService(platform.Service.LeakSensor));

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(this.getLeakDetected.bind(this, false))
      .on('change', this.notifyLeakChange.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.StatusTampered)
      .onGet(this.getTampered.bind(this))
      .on('change', this.notifyTamperedChange.bind(this));

    if ('temperature' in this.device.device.properties && (this.platform.config.temperatureSensors ?? true)) {
      this.temperatureService = this.accessory.getService(platform.Service.TemperatureSensor);
      if (!this.temperatureService) {
        this.log('info', 'Adding Temperature Support');
        this.temperatureService = this.accessory.addService(platform.Service.TemperatureSensor);
      }

      this.temperatureService.setCharacteristic(platform.Characteristic.Name, device.device.name + ' Temperature');

      this.temperatureService.getCharacteristic(platform.Characteristic.CurrentTemperature)
        .setProps({
          minStep: 0.01,
        })
        .onGet(this.getTemperature.bind(this))
        .on('change', this.notifyTemperatureChange.bind(this));
    } else if (!(this.platform.config.temperatureSensors ?? true) && this.accessory.getService(this.platform.Service.TemperatureSensor)) {
      this.log('warn', 'Removing Temperature Support');
      this.accessory.removeService(this.accessory.getService(this.platform.Service.TemperatureSensor)!);
    }
    this.device.onevent = event => {
      if (event.name === 'trouble') {
        if (event.value === 'senTamp' || event.value === 'senTampRes') {
          this.service.updateCharacteristic(this.platform.Characteristic.StatusTampered, 1);
        }
      }
      if (event.name === 'isFaulted') {
        this.device.device.properties.isFaulted = event.value === 'true';
        this.service.updateCharacteristic(this.platform.Characteristic.LeakDetected, this.getLeakDetected());
      }
      if ('sensorTemperature' in event.metadata) {
        this.device.device.properties.temperature = JSON.parse(event.metadata.sensorTemperature);
        this.temperatureService?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getTemperature());
      }
    };
    this.device.onchange = async (_oldState, newState) => {
      /** Normally not updated until AFTER `onchange` function execution */
      this.device.device = newState;
      this.service.updateCharacteristic(this.platform.Characteristic.StatusTampered, this.getTampered());
      this.service.updateCharacteristic(this.platform.Characteristic.LeakDetected, this.getLeakDetected(true));
      this.temperatureService?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getTemperature());

      this.accessory.context.logPath = this.logPath;
      this.accessory.context.device = newState;
      this.accessory.context.refreshToken = this.platform.xhome.refreshToken;
      this.platform.api.updatePlatformAccessories([this.accessory]);

      if (this.device.device.trouble.length && !this.getTampered()) {
        this.log('warn', 'Unknown trouble detected!');
        this.log('warn', 'Please open an issue about this.');
        this.log('warn', JSON.stringify(this.device.device.trouble, null, 2));
      }
    };
  }

  private getLeakDetected(skipUpdate?: boolean): CharacteristicValue {
    if (skipUpdate !== true) {
      this.device.get().catch(err => {
        this.log('error', 'Failed To Fetch Leak State With Error:', err);
        throw new this.StatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      });
    }
    return this.device.device.properties.isFaulted ? 1 : 0;
  }

  private async notifyLeakChange(value: CharacteristicChange): Promise<void> {
    if (value.newValue !== value.oldValue) {
      this.log(3, value.newValue === 0 ? 'Closed' : 'Opened');
    }
  }

  private getTampered(): CharacteristicValue {
    return this.device.device.trouble.find(trouble => trouble.name === 'senTamp') ? 1 : 0;
  }

  private async notifyTamperedChange(value: CharacteristicChange): Promise<void> {
    if (value.newValue !== value.oldValue) {
      if (value.newValue) {
        this.log('warn', 'Tampered');
      } else {
        this.log(2, 'Fixed');
      }
    }
  }

  private getTemperature(): CharacteristicValue {
    return this.device.device.properties.temperature / 100;
  }

  private async notifyTemperatureChange(value: CharacteristicChange): Promise<void> {
    if (value.newValue !== value.oldValue) {
      this.log(4, `Updating Temperature To ${value.newValue}°C`);
    }
  }
}