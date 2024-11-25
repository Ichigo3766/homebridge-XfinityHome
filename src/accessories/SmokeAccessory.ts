import { CharacteristicChange, CharacteristicValue, HAPStatus, PlatformAccessory, Service } from 'homebridge';
import { Smoke } from 'xfinityhome';

import { XfinityHomePlatform } from '../platform';
import { CONTEXT } from '../settings';
import Accessory from './Accessory';


export default class SmokeAccessory extends Accessory {
  protected temperatureService?: Service;

  constructor(
    private readonly platform: XfinityHomePlatform,
    private readonly accessory: PlatformAccessory<CONTEXT>,
    private readonly device: Smoke,
  ) {
    super(platform, accessory, device, accessory.getService(platform.Service.SmokeSensor) ||
      accessory.addService(platform.Service.SmokeSensor));

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.SmokeDetected)
      .onGet(this.getSmokeDetected.bind(this, false))
      .on('change', this.notifySmokeChange.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.StatusTampered)
      .onGet(this.getTampered.bind(this))
      .on('change', this.notifyTamperedChange.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getLowBattery.bind(this))
      .on('change', this.notifyLowBatteryChange.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(this.getFaulted.bind(this))
      .on('change', this.notifyFaultedChange.bind(this));

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
    this.device.onevent = async event => {
      if (event.name === 'trouble') {
        if (event.value === 'senTamp') {
          this.service.updateCharacteristic(this.platform.Characteristic.StatusTampered, 1);
        } else if (event.value === 'senTampRes') {
          this.service.updateCharacteristic(this.platform.Characteristic.StatusTampered, 0);
        }
        if (event.value === 'senPreLowBat' || event.value === 'senLowBat') {
          this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, 1);
          if (event.value === 'senLowBat') {
            this.service.updateCharacteristic(this.platform.Characteristic.StatusFault, 1);
          } else {
            this.service.updateCharacteristic(this.platform.Characteristic.StatusFault, 0);
          }
        }
      }
      if (event.name === 'isFaulted') {
        this.device.device.properties.isFaulted = event.value === 'true';
        this.service.updateCharacteristic(this.platform.Characteristic.SmokeDetected, await this.getSmokeDetected(true));
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
      this.service.updateCharacteristic(this.platform.Characteristic.StatusFault, this.getFaulted());
      this.service.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.getLowBattery());
      this.service.updateCharacteristic(this.platform.Characteristic.SmokeDetected, await this.getSmokeDetected(true));
      this.temperatureService?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getTemperature());

      this.accessory.context.logPath = this.logPath;
      this.accessory.context.device = newState;
      this.accessory.context.refreshToken = this.platform.xhome.refreshToken;
      this.platform.api.updatePlatformAccessories([this.accessory]);

      if (this.device.device.trouble.length && (!this.getTampered() && !this.getLowBattery())) {
        this.log('warn', 'Unknown trouble detected!');
        this.log('warn', 'Please open an issue about this.');
        this.log('warn', JSON.stringify(this.device.device.trouble, null, 2));
      }
    };
  }

  private async getSmokeDetected(skipUpdate?: boolean): Promise<CharacteristicValue> {
    if (skipUpdate !== true) {
      if (this.platform.config.lazyUpdates) {
        process.nextTick(() => {
          this.device.get().catch(err => {
            this.log('error', 'Failed To Fetch Smoke State With Error:', err);
            // throw new this.StatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
          });
        });
      } else {
        try {
          const device = await this.device.get();
          return device.properties.isFaulted ? 1 : 0;
        } catch (err) {
          this.log('error', 'Failed To Fetch Smoke State With Error:', err);
          return Promise.reject(new this.StatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        }
      }
    }
    return this.device.device.properties.isFaulted ? 1 : 0;
  }

  private async notifySmokeChange(value: CharacteristicChange): Promise<void> {
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

  private getFaulted(): CharacteristicValue {
    return this.device.device.trouble.find(trouble => trouble.name === 'senLowBat') ? 1 : 0;
  }

  private async notifyFaultedChange(value: CharacteristicChange): Promise<void> {
    if (value.newValue !== value.oldValue) {
      if (value.newValue) {
        this.log('warn', 'Faulted (Battery Level Is Very Low)');
      } else {
        this.log(2, 'Fault Restored');
      }
    }
  }

  private getLowBattery(): CharacteristicValue {
    return this.device.device.trouble.find(trouble => trouble.name === 'senPreLowBat' || trouble.name === 'senLowBat') ? 1 : 0;
  }

  private async notifyLowBatteryChange(value: CharacteristicChange): Promise<void> {
    if (value.newValue !== value.oldValue) {
      if (value.newValue) {
        this.device.device.trouble.forEach(trouble => {
          if (trouble.name === 'senPreLowBat') {
            this.log(1, 'Low Battery');
            this.device.device.deviceHelp ?
              this.log(1, `See ${this.device.device.deviceHelp.batteryReplacementWebUrl} for how to replace`) : undefined;
            this.device.device.deviceHelp ?
              this.log(1, `See ${this.device.device.deviceHelp.batteryPurchaseLink} for new batteries`) : undefined;
          }
          if (trouble.name === 'senLowBat') {
            this.log('warn', 'Critically Low Battery');
            this.device.device.deviceHelp ?
              this.log(1, `See ${this.device.device.deviceHelp.batteryReplacementWebUrl} for how to replace`) : undefined;
            this.device.device.deviceHelp ?
              this.log(1, `See ${this.device.device.deviceHelp.batteryPurchaseLink} for new batteries`) : undefined;
          }
        });
        this.log('warn', this.device.device.trouble[0].name === 'senPreLowBat' ? 'Low' : 'Critically Low', 'Battery');
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