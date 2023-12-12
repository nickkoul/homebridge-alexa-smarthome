import * as A from 'fp-ts/Array';
import * as O from 'fp-ts/Option';
import { Option, Some } from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import {
  constFalse,
  constTrue,
  flow,
  identity,
  pipe,
} from 'fp-ts/lib/function';
import { CharacteristicValue, Service } from 'homebridge';
import { CapabilityState, SupportedActionsType } from '../domain/alexa';
import {
  ThermostatNamespaces,
  ThermostatNamespacesType,
  ThermostatState,
} from '../domain/alexa/thermostat';
import * as tempMapper from '../mapper/temperature-mapper';
import * as tstatMapper from '../mapper/thermostat-mapper';
import BaseAccessory from './base-accessory';
import {
  Temperature,
  TemperatureScale,
  isTemperatureValue,
} from '../domain/alexa/temperature';

export default class ThermostatAccessory extends BaseAccessory {
  static requiredOperations: SupportedActionsType[] = ['setTargetTemperature'];
  service: Service;
  namespaces = ThermostatNamespaces;
  isExternalAccessory = false;

  configureServices() {
    this.service =
      this.platformAcc.getService(this.Service.Thermostat) ||
      this.platformAcc.addService(
        this.Service.Thermostat,
        this.device.displayName,
      );

    // "namespace": "Alexa.ThermostatController.HVAC.Components"
    // Actively Heating, Cooling, or Idle
    this.service
      .getCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
      )
      .onGet(this.handleCurrentStateGet.bind(this));

    //Mode = Heat,Cool,Auto,Off
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetStateGet.bind(this))
      .onSet(this.handleTargetStateSet.bind(this));

    // Return ambient temperature reading
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTempGet.bind(this));

    // Return ambient humidity reading
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.handleCurrentHumidGet.bind(this));

    // Farenheit or Celsius
    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTempUnitsGet.bind(this))
      .onSet(() => {
        throw this.readOnlyError;
      });

    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleTargetTempGet.bind(this))
      .onSet(this.handleTargetTempSet.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
      )
      .onGet(this.handleCoolTempGet.bind(this))
      .onSet(this.handleCoolTempSet.bind(this));

    this.service
      .getCharacteristic(
        this.platform.Characteristic.HeatingThresholdTemperature,
      )
      .onGet(this.handleHeatTempGet.bind(this))
      .onSet(this.handleHeatTempSet.bind(this));
  }

  async handleCurrentTempGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType = 'Alexa.TemperatureSensor';
    const determineCurrentTemp = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(({ namespace }) => namespace === alexaNamespace),
      ),
      O.flatMap(({ value }) => tempMapper.mapAlexaTempToHomeKit(value)),
      O.tap((s) =>
        O.of(
          this.logWithContext('debug', `Get current temperature result: ${s}`),
        ),
      ),
    );

    return pipe(
      this.getState(determineCurrentTemp),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get current temperature', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleCurrentHumidGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType = 'Alexa.HumiditySensor';
    const determineCurrentHumid = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(({ namespace }) => namespace === alexaNamespace),
      ),
      O.flatMap(({ value }) => tempMapper.mapAlexaHumidToHomeKit(value)),
      O.tap((s) =>
        O.of(this.logWithContext('debug', `Get current humidty result: ${s}`)),
      ),
    );

    return pipe(
      this.getState(determineCurrentHumid),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get current humidity', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleTempUnitsGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType = 'Alexa.TemperatureSensor';
    const determineTempUnits = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(({ namespace }) => namespace === alexaNamespace),
      ),
      O.flatMap(({ value }) =>
        tempMapper.mapAlexaTempUnitsToHomeKit(value, this.Characteristic),
      ),
      O.tap((s) => {
        return O.of(
          this.logWithContext('debug', `Get temperature units result: ${s}`),
        );
      }),
    );

    return pipe(
      this.getState(determineTempUnits),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get temperature units', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleTargetStateGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const alexaValueName = 'thermostatMode';
    const determineTargetState = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(
          ({ name, namespace }) =>
            namespace === alexaNamespace && name === alexaValueName,
        ),
      ),
      O.map(({ value }) =>
        tstatMapper.mapAlexaModeToHomeKit(value, this.Characteristic),
      ),
      O.tap((s) =>
        O.of(this.logWithContext('debug', `Get thermostat mode result: ${s}`)),
      ),
    );

    return pipe(
      this.getState(determineTargetState),
      TE.match((e) => {
        this.logWithContext('errorT', 'Get thermostat mode', e);
        throw this.serviceCommunicationError;
      }, identity),
    )();
  }

  async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    this.logWithContext('debug', `Triggered mode setting: ${value}`);
    const newMode = tstatMapper.mapHomeKitModetoAlexa(
      value,
      this.Characteristic,
    );
    return pipe(
      this.platform.alexaApi.setDeviceState(
        this.device.id,
        'setThermostatMode',
        {
          'thermostatMode.value': newMode.toString(),
        },
      ),
      TE.match(
        (e) => {
          this.logWithContext('errorT', 'Set mode', e);
          throw this.serviceCommunicationError;
        },
        () => {
          this.updateCacheValue({
            value: newMode,
            namespace: 'Alexa.ThermostatController',
            name: 'thermostatMode',
          });
        },
      ),
    )();
  }

  async handleCurrentStateGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController.HVAC.Components';
    const alexaValueName = 'primaryHeaterOperation';
    //need to add state detection for cooling
    //Don't know how to "search" or write a proper if/else coniditional in TS
    //coolerOperation is the "ValueName" when cooling
    //if in Auto mode both primaryHeaterOperation and coolerOperation values show so need to check both
    const determineCurrentStateHeat = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(
          ({ name, namespace }) =>
            namespace === alexaNamespace && name === alexaValueName,
        ),
      ),
      O.map(({ value }) =>
        tstatMapper.mapAlexaHeatingStatusToHomeKit(value, this.Characteristic),
      ),
      O.tap((s) =>
        O.of(
          this.logWithContext(
            'debug',
            `Get thermostat heating state result: ${s}`,
          ),
        ),
      ),
    );
    // dummy value just to get build to work until we figure it out
    return 69 
    //    const determineCurrentStateCool = flow(
    //      O.filterMap<ThermostatState[], ThermostatState>(
    //        A.findFirst(
    //          ({ name, namespace }) =>
    //            namespace === alexaNamespace && name === alexaValueName,
    //        ),
    //      ),
    //      O.map(({ value }) =>
    //        tstatMapper.mapAlexaCoolingStatusToHomeKit(value, this.Characteristic),
    //      ),
    //      O.tap((s) =>
    //        O.of(
    //          this.logWithContext(
    //            'debug',
    //            `Get thermostat cooling state result: ${s}`,
    //          ),
    //        ),
    //      ),
    //    );
    //don't know if this would work, only heat or cool can be on at a given time, off = 0, heat = 1, cool = 2
    //    return pipe(
    //      this.getState(determineCurrentStateCool + determineCurrentStateHeat),
    //      TE.match((e) => {
    //        this.logWithContext('errorT', 'Get thermostat heating state', e);
    //        throw this.serviceCommunicationError;
    //      }, identity),
    //    )();
  }

  async handleTargetTempGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const alexaValueName = 'targetSetpoint';
    const determineTargetTemp = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(
          ({ name, namespace }) =>
            namespace === alexaNamespace && name === alexaValueName,
        ),
      ),
      O.flatMap(({ value }) => tempMapper.mapAlexaTempToHomeKit(value)),
      O.tap((s) =>
        O.of(
          this.logWithContext('debug', `Get target temperature result: ${s}`),
        ),
      ),
    );

    const targetTempOnAuto = this.calculateTargetTemp();
    if (this.onInvalidOrAutoMode() && O.isSome(targetTempOnAuto)) {
      return targetTempOnAuto.value;
    } else {
      return pipe(
        this.getState(determineTargetTemp),
        TE.match((e) => {
          this.logWithContext('errorT', 'Get target temperature', e);
          throw this.serviceCommunicationError;
        }, identity),
      )();
    }
  }

  async handleTargetTempSet(value: CharacteristicValue): Promise<void> {
    this.logWithContext('debug', `Triggered set target temperature: ${value}`);
    const maybeTemp = this.getCacheValue('Alexa.TemperatureSensor');
    //If received bad data stop
    //If in Auto mode stop
    if (this.onInvalidOrAutoMode() || !this.isTempWithScale(maybeTemp)) {
      return;
    }
    if (typeof value !== 'number') {
      throw this.invalidValueError;
    }
    const units = maybeTemp.value.scale.toLowerCase() as TemperatureScale;
    const newTemp = tempMapper.mapHomeKitTempToAlexa(value, units);
    return pipe(
      this.platform.alexaApi.setDeviceState(
        this.device.id,
        'setTargetTemperature',
        {
          'targetTemperature.scale': units,
          'targetTemperature.value': newTemp.toString(10),
        },
      ),
      TE.match(
        (e) => {
          this.logWithContext('errorT', 'Set target temperature', e);
          throw this.serviceCommunicationError;
        },
        () => {
          this.updateCacheValue({
            value: {
              value: newTemp,
              scale: units.toUpperCase(),
            },
            namespace: 'Alexa.ThermostatController',
            name: 'targetSetpoint',
          });
        },
      ),
    )();
  }

  async handleCoolTempGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const alexaValueName = 'upperSetpoint';
    const determineCoolTemp = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(
          ({ name, namespace }) =>
            namespace === alexaNamespace && name === alexaValueName,
        ),
      ),
      O.flatMap(({ value }) => tempMapper.mapAlexaTempToHomeKit(value)),
      O.tap((s) =>
        O.of(
          this.logWithContext('debug', `Get cooling temperature result: ${s}`),
        ),
      ),
    );

    const autoTemp = this.getAutoTempFromTargetTemp();
    if (this.onAutoMode() || O.isNone(autoTemp)) {
      return pipe(
        this.getState(determineCoolTemp),
        TE.match((e) => {
          this.logWithContext('errorT', 'Get cooling temperature', e);
          throw this.serviceCommunicationError;
        }, identity),
      )();
    } else {
      return autoTemp.value;
    }
  }

  async handleCoolTempSet(value: CharacteristicValue): Promise<void> {
    this.logWithContext('debug', `Triggered set cooling temperature: ${value}`);
    const maybeHeatTemp = this.getCacheValue(
      'Alexa.ThermostatController',
      'lowerSetpoint',
    );
    if (!this.isTempWithScale(maybeHeatTemp)) {
      throw this.notAllowedError;
    }
    const heatTemp = maybeHeatTemp.value;
    if (typeof value !== 'number' || typeof heatTemp !== 'number') {
      throw this.invalidValueError;
    }
    const units = maybeHeatTemp.value.scale.toLowerCase() as TemperatureScale;
    const newCoolTemp = tempMapper.mapHomeKitTempToAlexa(value, units);

    return pipe(
      this.platform.alexaApi.setDeviceState(
        this.device.id,
        'setTargetTemperature',
        {
          'upperSetpoint.scale': units,
          'upperSetpoint.value': newCoolTemp.toString(10),
          'lowerSetpoint.scale': units,
          'lowerSetpoint.value': tempMapper
            .mapHomeKitTempToAlexa(heatTemp, units)
            .toString(10),
        },
      ),
      TE.match(
        (e) => {
          this.logWithContext('errorT', 'Set cooling temperature', e);
          throw this.serviceCommunicationError;
        },
        () => {
          this.updateCacheValue({
            value: {
              value: newCoolTemp,
              scale: units.toUpperCase(),
            },
            namespace: 'Alexa.ThermostatController',
            name: 'upperSetpoint',
          });
        },
      ),
    )();
  }

  async handleHeatTempGet(): Promise<number> {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const alexaValueName = 'lowerSetpoint';
    const determineHeatTemp = flow(
      O.filterMap<ThermostatState[], ThermostatState>(
        A.findFirst(
          ({ name, namespace }) =>
            namespace === alexaNamespace && name === alexaValueName,
        ),
      ),
      O.flatMap(({ value }) => tempMapper.mapAlexaTempToHomeKit(value)),
      O.tap((s) =>
        O.of(
          this.logWithContext('debug', `Get heating temperature result: ${s}`),
        ),
      ),
    );

    const autoTemp = this.getAutoTempFromTargetTemp();
    if (this.onAutoMode() || O.isNone(autoTemp)) {
      return pipe(
        this.getState(determineHeatTemp),
        TE.match((e) => {
          this.logWithContext('errorT', 'Get heating temperature', e);
          throw this.serviceCommunicationError;
        }, identity),
      )();
    } else {
      return autoTemp.value;
    }
  }

  async handleHeatTempSet(value: CharacteristicValue): Promise<void> {
    this.logWithContext('debug', `Triggered set heating temperature: ${value}`);
    const maybeCoolTemp = this.getCacheValue(
      'Alexa.ThermostatController',
      'upperSetpoint',
    );
    if (!this.isTempWithScale(maybeCoolTemp)) {
      throw this.notAllowedError;
    }
    const coolTemp = maybeCoolTemp.value;
    if (typeof value !== 'number' || typeof coolTemp !== 'number') {
      throw this.invalidValueError;
    }
    const units = maybeCoolTemp.value.scale.toLowerCase() as TemperatureScale;
    const newHeatTemp = tempMapper.mapHomeKitTempToAlexa(value, units);

    return pipe(
      this.platform.alexaApi.setDeviceState(
        this.device.id,
        'setTargetTemperature',
        {
          'lowerSetpoint.scale': units,
          'lowerSetpoint.value': newHeatTemp.toString(10),
          'upperSetpoint.scale': units,
          'upperSetpoint.value': tempMapper
            .mapHomeKitTempToAlexa(coolTemp, units)
            .toString(10),
        },
      ),
      TE.match(
        (e) => {
          this.logWithContext('errorT', 'Set heating temperature', e);
          throw this.serviceCommunicationError;
        },
        () => {
          this.updateCacheValue({
            value: {
              value: newHeatTemp,
              scale: units.toUpperCase(),
            },
            namespace: 'Alexa.ThermostatController',
            name: 'lowerSetpoint',
          });
        },
      ),
    )();
  }

  private getAutoTempFromTargetTemp() {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const alexaValueName = 'targetSetpoint';
    const maybeTargetTemp = this.getCacheValue(alexaNamespace, alexaValueName);
    if (this.isTempWithScale(maybeTargetTemp)) {
      return tempMapper.mapAlexaTempToHomeKit({
        value: maybeTargetTemp.value.value,
        scale: maybeTargetTemp.value.scale.toUpperCase(),
      });
    } else {
      return O.none;
    }
  }

  private calculateTargetTemp() {
    const alexaNamespace: ThermostatNamespacesType =
      'Alexa.ThermostatController';
    const maybeHeatTemp = this.getCacheValue(alexaNamespace, 'lowerSetpoint');
    const maybeCoolTemp = this.getCacheValue(alexaNamespace, 'upperSetpoint');
    if (
      this.isTempWithScale(maybeHeatTemp) &&
      this.isTempWithScale(maybeCoolTemp)
    ) {
      const heatTemp = maybeHeatTemp.value.value;
      const coolTemp = maybeCoolTemp.value.value;
      return tempMapper.mapAlexaTempToHomeKit({
        value: (coolTemp + heatTemp) / 2,
        scale: maybeCoolTemp.value.scale.toUpperCase(),
      });
    } else {
      return O.none;
    }
  }

  private isTempWithScale(
    value: Option<CapabilityState['value']>,
  ): value is Some<Temperature> {
    return O.isSome(value) && isTemperatureValue(value.value);
  }

  private onInvalidOrAutoMode() {
    return pipe(
      this.getCacheValue('Alexa.ThermostatController', 'thermostatMode'),
      O.match(constTrue, (m) => m === 'AUTO'),
    );
  }

  private onAutoMode() {
    return pipe(
      this.getCacheValue('Alexa.ThermostatController', 'thermostatMode'),
      O.match(constFalse, (m) => m === 'AUTO'),
    );
  }
}
