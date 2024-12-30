var Service;
var Characteristic;

var mqtt = require("mqtt");

var tableauValve = [];
var tableauSwitch = [];

const date = require('date-and-time');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-vanneCommande-mqtt', 'VanneCommande-mqtt', ValveCmdAccessoryMqtt);
  homebridge.registerAccessory('homebridge-switchCommande-mqtt', 'SwitchCommande-mqtt', SwitchCmdAccessoryMqtt);
};

function SwitchCmdAccessoryMqtt(log, config) {
  this.log = log;
  this.name = config.name;
  this.indice = config.indice;
  this.etatSwitch = false; //Etat initial

  tableauSwitch[this.indice] = this;
  
  this.log('Fin SwitchmdAccessoryMqtt');
}

SwitchCmdAccessoryMqtt.prototype.setOn = function(estOn, callback, context) {
  if (context === 'pollState') {
    // The state has been updated by the pollState command - don't run the open/close command
    callback(null);
    return;
  }

  var accessory = this;
  var accessoryValve = tableauValve[this.indice];

  if(estOn) {
    accessory.etatSwitch = true;
    if(accessoryValve.etatValveDemande == Characteristic.Active.INACTIVE) {
      accessoryValve.modeManuel = false;
      accessory.log("mode Manuel = false");
      accessoryValve.valveService.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.ACTIVE);
    }
    accessory.log('Appel de setOn : True');
  } else {
    accessory.etatSwitch = false;
    if(accessoryValve.etatValveDemande == Characteristic.Active.ACTIVE) {
      accessoryValve.valveService.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.INACTIVE);
    }
    accessory.log('Appel de setOn : False');
  }

  callback();
  return true;
};

SwitchCmdAccessoryMqtt.prototype.getOn = function(callback) {
  var accessory = this;

  accessory.log('Appel de getOn');
  callback(null, accessory.etatSwitch);
}

SwitchCmdAccessoryMqtt.prototype.getServices = function() {
  this.log('Debut Getservices');
  this.informationService = new Service.AccessoryInformation();
  this.switchService = new Service.Switch(this.name);

  this.informationService
  .setCharacteristic(Characteristic.Manufacturer, 'Capitaine Kirk Factory')
  .setCharacteristic(Characteristic.Model, 'Switch Command Mqtt')
  .setCharacteristic(Characteristic.SerialNumber, '1.0');

  this.switchService.getCharacteristic(Characteristic.On)
  .on('set', this.setOn.bind(this))
  .on('get', this.getOn.bind(this))
  .updateValue(this.etatSwitch);


  return [this.informationService, this.switchService];
}

function ValveCmdAccessoryMqtt(log, config) {
  this.log = log;
  this.name = config.name;

  this.module = config.module;
  this.port = config.port;
  this.indice = config.indice;
  this.dureeDemandee = config.dureeDemandee || 900;
  this.intervalLecture = config.intervalLecture || 1;
  this.etatValveDemande = Characteristic.Active.INACTIVE; //Etat initial
  this.etatValveActuel = Characteristic.InUse.NOT_IN_USE; //Etat initial
  this.etatValveEnDefaut = Characteristic.StatusFault.NO_FAULT; //Etat initial
  this.capteurValveOuvert = false;
  this.capteurValveEnDefaut = false;
  this.modeManuel = false;
  this.dureeRestante = 0;

  this.debug = config.debug || 0;

  tableauValve[this.indice] = this;

  this.client_Id = 'mqttCommande' + config.module + '-' + config.port;
  this.options = {
    keepalive: 10,
    clientId: this.client_Id,
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30 * 1000,
    will: {
      topic: 'WillMsg',
      payload: 'Connection Closed abnormally..!',
      qos: 0,
      retain: false
    },
    rejectUnauthorized: false
  };

  this.client = mqtt.connect("mqtt://localhost", this.options);

  this.client.on('error', this.mqttGererErreur.bind(this));
  this.client.on('connect', this.mqttGererConnexion.bind(this));
  this.client.on('message', this.mqttGererMessage.bind(this));

  this.mqttTopicEtatVanne = "NetworkModule/" + config.module + "/output/0" + config.port;
  this.mqttTopicCommandeVanne  = "NetworkModule/" + config.module + "/output/0" + config.port + "/set";
  this.mqttTopicDisponibiliteVanne  = "NetworkModule/" + config.module + "/availability";

  this.client.subscribe(this.mqttTopicEtatVanne);
  this.client.subscribe(this.mqttTopicCommandeVanne);
  this.client.subscribe(this.mqttTopicDisponibiliteVanne);

  if(this.debug) {
     this.log("mqttTopicEtatVanne = " + this.mqttTopicEtatVanne);
     this.log("mqttTopicCommandeVanne = " + this.mqttTopicCommandeVanne);
     this.log("mqttTopicDisponibiliteVanne = " + this.mqttTopicDisponibiliteVanne);
  }

  this.log('Fin ValveCmdAccessoryMqtt');

 //A short summary for Active / InUse - Logic:
 //Active=0, InUse=0 -> Off
 //Active=1, InUse=0 -> Waiting [Starting, Activated but no water flowing (yet)]
 //Active=1, InUse=1 -> Running
 //Active=0, InUse=1 -> Stopping
}

ValveCmdAccessoryMqtt.prototype.setActive = function(estActive, callback, context) {
  if (context === 'pollState') {
    // The state has been updated by the pollState command - don't run the open/close command
    callback(null);
    return;
  }

  var accessory = this;
  var accessorySwitch = tableauSwitch[this.indice];


  if(estActive == Characteristic.Active.ACTIVE) {
    accessory.etatValveDemande = Characteristic.Active.ACTIVE;
    if(!accessorySwitch.etatSwitch) {
      accessory.modeManuel = true;
      accessory.log("mode Manuel = true");
      accessorySwitch.switchService.getCharacteristic(Characteristic.On).setValue(true);
    }
    accessory.log('Appel de setActive : etatValveDemande = ACTIVE');
  }
  if(estActive == Characteristic.Active.INACTIVE) {
    accessory.etatValveDemande = Characteristic.Active.INACTIVE;
    if(accessorySwitch.etatSwitch) {
      accessorySwitch.switchService.getCharacteristic(Characteristic.On).setValue(false);
    }
    accessory.log('Appel de setActive : etatValveDemande = INACTIVE');
  }

  if (accessory.stateTimer) {
     clearTimeout(this.stateTimer);
     accessory.stateTimer = null;
  }
  accessory.stateTimer = setImmediate(accessory.GererEtat.bind(accessory));

  callback();
  return true;
};

ValveCmdAccessoryMqtt.prototype.getActive = function(callback) {
  var accessory = this;

  accessory.log('Appel de getActive');
  callback(null, accessory.etatValveDemande);
}

ValveCmdAccessoryMqtt.prototype.getInUse = function(callback) {
  var accessory = this;

  accessory.log('Appel de getInUse');
  callback(null, accessory.etatValveActuel);
}

ValveCmdAccessoryMqtt.prototype.setSetDuration = function(duration, callback, context) {
  if (context === 'pollState') {
    // The state has been updated by the pollState command - don't run the open/close command
    callback(null);
    return;
  }

  var accessory = this;

  accessory.dureeDemandee = duration;
  accessory.log('Appel de setSetDuration : Duree = ',duration);

  callback();
  return true;
};

ValveCmdAccessoryMqtt.prototype.getSetDuration = function(callback) {
  var accessory = this;

  accessory.log('Appel de getSetDuration');
  callback(null, accessory.dureeDemandee);
}

ValveCmdAccessoryMqtt.prototype.setRemainingDuration = function(duration, callback, context) {
  if (context === 'pollState') {
    // The state has been updated by the pollState command - don't run the open/close command
    callback(null);
    return;
  }

  var accessory = this;

  accessory.dureeRestante = duration;
  accessory.log('Appel de setRemainingDuration : Duree = ',duration);

  callback();
  return true;
};

ValveCmdAccessoryMqtt.prototype.getRemainingDuration = function(callback) {
  var accessory = this;

  accessory.log('Appel de getRemainingDuration');
  callback(null, accessory.dureeRestante);
}

ValveCmdAccessoryMqtt.prototype.getStatusFault = function(callback) {
  var accessory = this;

  accessory.log('Appel de getStatusFault');
  callback(null, accessory.etatValveEnDefaut);
}

ValveCmdAccessoryMqtt.prototype.mqttGererErreur = function() {
  var accessory = this;

  accessory.log("Erreur Mqtt");
}

ValveCmdAccessoryMqtt.prototype.mqttGererConnexion = function(topic, message) {
  var accessory = this;

  accessory.log("Confirmation de la connexion au broker MQTT");
}

ValveCmdAccessoryMqtt.prototype.mqttGererMessage = function(topic, message) {
  var accessory = this;
  var status;

  if(accessory.debug) {
    accessory.log("Message brut = " + message.toString());
  }

  // Capteur      ON   OFF
  // VanneOuverte Faux Vrai

  status = message.toString();
  accessory.log("Message reçu de " + accessory.name + " : " + topic + " = " + status);

  messageRecu = false;

  switch(topic) {
    case accessory.mqttTopicEtatVanne :
      switch(status) {
        case 'ON' :
          accessory.capteurValveOuvert = true;
          accessory.capteurValveEnDefaut = false;
          if(accessory.debug) {
            accessory.log('Réception Mqtt, état d\'ouverture de la vanne de ' + accessory.name + ' est : vrai ');
          }
          messageRecu = true;
          break;
        case 'OFF' :
          accessory.capteurValveOuvert = false;
          accessory.capteurValveEnDefaut = false;
          if(accessory.debug) {
            accessory.log('Réception Mqtt, état d\'ouverture de la vanne de ' + accessory.name + ' est : faux ');
          }
          messageRecu = true;
        break;
        default :
        break;
      }
    break;
    case accessory.mqttTopicDisponibiliteVanne :
      switch(status) {
        case 'online' :
          accessory.capteurValveEnDefaut = false;
          if(accessory.debug) {
            accessory.log('Réception Mqtt, état de disponibilite  de la vanne de ' + accessory.name + ' est : vrai ');
          }
          messageRecu = true;
        break;
        case 'offline' :
          accessory.capteurValveEnDefaut = true;
          if(accessory.debug) {
            accessory.log('Réception Mqtt, état de disponibilite  de la vanne de ' + accessory.name + ' est : faux ');
          }
          messageRecu = true;
        break;
      }
    break;
  }
  if(messageRecu) {
    if (accessory.stateTimer) {
       clearTimeout(this.stateTimer);
       accessory.stateTimer = null;
    }
    accessory.stateTimer = setImmediate(accessory.GererEtat.bind(accessory));
  }
}

ValveCmdAccessoryMqtt.prototype.GererEtat = function() {
  var accessory = this;
  var accessorySwitch = tableauSwitch[this.indice];

  var lectureCapteur = '';
  var valveChange = false;

  if(accessory.debug) {
    if(accessorySwitch.etatSwitch) {
      accessory.log("etatSwitch = ON");
    } else {
      accessory.log("etatSwitch = OFF");
    }

    if(accessory.etatValveDemande == Characteristic.Active.ACTIVE) {
      accessory.log("etatValveActive = ACTIVE");
    } else {
      accessory.log("etatValveActive = INACTIVE");
    }

    if(accessory.modeManuel) {
      accessory.log('Mode manuel');
    } else {
      accessory.log('Mode automatique');
    }
  }

  if ((accessory.capteurValveEnDefaut && (accessory.etatValveEnDefaut == Characteristic.StatusFault.NO_FAULT)) ||
      (!accessory.capteurValveEnDefaut && (accessory.etatValveEnDefaut == Characteristic.StatusFault.GENERAL_FAULT))) {
    if(accessory.capteurValveEnDefaut) {
      accessory.log("Etat defaut de " + accessory.name + " est : GENERAL_FAULT");
      accessory.etatValveEnDefaut = Characteristic.StatusFault.GENERAL_FAULT;
    } else {
      accessory.log("Etat defaut de " + accessory.name + " est : NO_FAULT");
      accessory.etatValveEnDefaut = Characteristic.StatusFault.NO_FAULT;
    }
    accessory.valveService.getCharacteristic(Characteristic.StatusFault).updateValue(accessory.etatValveEnDefaut);
  }

  if(!accessory.capteurValveEnDefaut) {
    
    if(accessory.capteurValveOuvert) {
      if(accessory.etatValveDemande == Characteristic.Active.INACTIVE) {
        accessory.log("Etat demande de " + accessory.name + " est : INACTIVE");
        commande = "OFF";
        valveChange = true;
      } else {
        if(accessory.etatValveActuel != Characteristic.InUse.IN_USE) {
          accessory.etatValveActuel = Characteristic.InUse.IN_USE;
          accessory.valveService.getCharacteristic(Characteristic.InUse).updateValue(accessory.etatValveActuel);
          accessory.dateDebut = new Date();
          // si mode manuel et duree demandee != 0
          if((accessory.modeManuel) && (accessory.dureeDemandee != 0)) {
            accessory.valveService.getCharacteristic(Characteristic.RemainingDuration).updateValue(accessory.dureeDemandee);
            accessory.log("Mode manuel, durée demandée = " + accessory.dureeDemandee + " s");
          }
        }
      }
    } else {
      if(accessory.etatValveDemande == Characteristic.Active.ACTIVE) {
        accessory.log("Etat demande de " + accessory.name + " est : ACTIVE");
        commande = "ON";
        valveChange = true;
      } else {
        if(accessory.etatValveActuel != Characteristic.InUse.NOT_IN_USE) {
          accessory.etatValveActuel = Characteristic.InUse.NOT_IN_USE;
          accessory.valveService.getCharacteristic(Characteristic.InUse).updateValue(accessory.etatValveActuel);
          // ne pas oublier de remettre a zero le compteur de temps restant
          accessory.valveService.getCharacteristic(Characteristic.RemainingDuration).updateValue(0);
        }
      }
    }
  }

  if((accessory.etatValveActuel == Characteristic.InUse.IN_USE) && (accessory.modeManuel) && (accessory.dureeDemandee != 0)) {
    var dateActuelle = new Date();
    var deltaSecondes = date.subtract(dateActuelle, accessory.dateDebut).toSeconds();

    accessory.dureeRestante = accessory.dureeDemandee - deltaSecondes;;

    if(accessory.debug) {
      accessory.log("Temps écoulé = "+ deltaSecondes + " s, temps restant = " + accessory.dureeRestante + " s");
    }

    if(accessory.dureeRestante < 0) {
      accessory.log("Fin du délai d'arrosage");
      accessory.log("Etat demande de " + accessory.name + " est : INACTIVE");
      accessory.valveService.getCharacteristic(Characteristic.Active).setValue(Characteristic.Active.INACTIVE);
    } else {
      // si le delai n'est pas termine, relance de la fontion GererEtat dans une seconde
      // Clear any existing timer
      if (accessory.stateTimer) {
        clearTimeout(accessory.stateTimer);
        accessory.stateTimer = null;
      }
      accessory.stateTimer = setTimeout(this.GererEtat.bind(this),(accessory.intervalLecture) * 1000);
    }
  }

  if(valveChange) {
    accessory.client.publish(accessory.mqttTopicCommandeVanne, commande, { qos: 0 });
  }
}

ValveCmdAccessoryMqtt.prototype.getServices = function() {
  this.log('Debut Getservices');
  this.informationService = new Service.AccessoryInformation();
  this.valveService = new Service.Valve(this.name);

  this.log('Debut informationService');
  this.informationService
  .setCharacteristic(Characteristic.Manufacturer, 'Capitaine Kirk Factory')
  .setCharacteristic(Characteristic.Model, 'Valve Command Mqtt')
  .setCharacteristic(Characteristic.SerialNumber, '1.0');

  // choisi l'icone d'arrosage
  this.log('Debut ValveType');
  this.valveService.getCharacteristic(Characteristic.ValveType).updateValue(Characteristic.ValveType.IRRIGATION);

  this.log('Debut getCharacteristicActive');
  this.valveService.getCharacteristic(Characteristic.Active)
  .on('set', this.setActive.bind(this))
  .on('get', this.getActive.bind(this))
  .updateValue(this.etatValveDemande);

  this.valveService.getCharacteristic(Characteristic.InUse)
  .on('get', this.getInUse.bind(this))
  .updateValue(this.etatValveActuel);

  this.valveService.getCharacteristic(Characteristic.SetDuration)
  .on('set', this.setSetDuration.bind(this))
  .on('get', this.getSetDuration.bind(this))
  .updateValue(this.dureeDemandee);

  this.valveService.getCharacteristic(Characteristic.RemainingDuration)
  .on('set', this.setRemainingDuration.bind(this))
  .on('get', this.getRemainingDuration.bind(this))
  .updateValue(this.dureeRestante);

  this.valveService.getCharacteristic(Characteristic.StatusFault)
  .on('get', this.getStatusFault.bind(this))
  .updateValue(this.etatValveEnDefaut);

  this.stateTimer = setTimeout(this.GererEtat.bind(this),this.intervalLecture * 1000);

  return [this.informationService, this.valveService];
}
