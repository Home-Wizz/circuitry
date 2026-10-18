import deNodes from '@/i18n/locales/de/nodes.json';
import enNodes from '@/i18n/locales/en/nodes.json';
import type { EntityActionCategory } from '@/lib/actionRecipes';

/** A catalog action's name and description in one language. */
interface ActionText {
  label: string;
  description: string;
}

/** The action catalog's own texts in one language, by category domain and
 * by action id. */
interface ActionCatalogTexts {
  /** The language's domain names (`nodes:serviceDomains`). */
  domainNames: Readonly<Record<string, string>>;
  headings: Readonly<Record<string, string>>;
  actions: Readonly<Record<string, ActionText>>;
}

/** The domain names the device actions are listed under, in English. */
const EN_DOMAIN_NAMES: Readonly<Record<string, string>> = enNodes.serviceDomains;

const DE: ActionCatalogTexts = {
  domainNames: deNodes.serviceDomains,
  // Only the categories whose English heading is not the domain name the
  // device actions are listed under (see localizedActionCatalog).
  headings: {
    valve: 'Ventil',
    alarm_control_panel: 'Alarmanlage',
    ai_task: 'KI-Aufgabe',
    assist_satellite: 'Assist-Satellit',
    date: 'Datum',
    datetime: 'Datum/Uhrzeit',
    input_boolean: 'Schalter-Helfer',
    input_button: 'Tasten-Helfer',
    input_number: 'Zahlen-Helfer',
    input_select: 'Dropdown-Helfer',
    input_text: 'Text-Helfer',
    input_datetime: 'Datum/Uhrzeit-Helfer',
    notify: 'Benachrichtigung',
  },

  actions: {
    light_turn_on: {
      label: 'Licht einschalten',
      description:
        'Schaltet ein Licht ein. Wahlweise mit Helligkeit, Farbe, Farbtemperatur, einem Effekt oder einem Übergang.',
    },
    light_turn_off: {
      label: 'Licht ausschalten',
      description:
        'Schaltet ein Licht aus. Wahlweise mit einem Übergang zum Ausblenden oder einem kurzen Blinken davor.',
    },
    light_toggle: {
      label: 'Licht umschalten',
      description: 'Schaltet ein Licht um: Ist es aus, geht es an; ist es an, geht es aus.',
    },
    switch_turn_on: { label: 'Schalter einschalten', description: 'Schaltet einen Schalter ein.' },
    switch_turn_off: { label: 'Schalter ausschalten', description: 'Schaltet einen Schalter aus.' },
    switch_toggle: { label: 'Schalter umschalten', description: 'Schaltet einen Schalter um.' },
    fan_turn_on: {
      label: 'Lüfter einschalten',
      description:
        'Schaltet einen Lüfter ein. Wahlweise gleich mit Geschwindigkeit oder Voreinstellung.',
    },
    fan_turn_off: { label: 'Lüfter ausschalten', description: 'Schaltet einen Lüfter aus.' },
    fan_toggle: { label: 'Lüfter umschalten', description: 'Schaltet einen Lüfter um.' },
    fan_increase_speed: {
      label: 'Lüfter schneller',
      description: 'Erhöht die Geschwindigkeit eines Lüfters.',
    },
    fan_decrease_speed: {
      label: 'Lüfter langsamer',
      description: 'Verringert die Geschwindigkeit eines Lüfters.',
    },
    fan_oscillate: {
      label: 'Lüfter schwenken',
      description: 'Schaltet das Schwenken eines Lüfters ein oder aus.',
    },
    fan_set_direction: {
      label: 'Lüfter-Drehrichtung festlegen',
      description: 'Legt die Drehrichtung eines Lüfters fest.',
    },
    fan_set_preset_mode: {
      label: 'Lüfter-Voreinstellung festlegen',
      description: 'Legt die Voreinstellung eines Lüfters fest.',
    },
    cover_open: { label: 'Abdeckung öffnen', description: 'Öffnet eine Abdeckung.' },
    cover_close: { label: 'Abdeckung schließen', description: 'Schließt eine Abdeckung.' },
    cover_stop: { label: 'Abdeckung anhalten', description: 'Hält eine Abdeckung an.' },
    cover_toggle: {
      label: 'Abdeckung umschalten',
      description: 'Öffnet eine geschlossene Abdeckung oder schließt eine offene.',
    },
    cover_set_position: {
      label: 'Abdeckungsposition festlegen',
      description: 'Fährt eine Abdeckung auf eine bestimmte Position.',
    },
    cover_open_tilt: {
      label: 'Lamellen öffnen',
      description: 'Kippt die Lamellen einer Abdeckung auf.',
    },
    cover_close_tilt: {
      label: 'Lamellen schließen',
      description: 'Kippt die Lamellen einer Abdeckung zu.',
    },
    cover_stop_tilt: {
      label: 'Lamellen anhalten',
      description: 'Hält das Kippen der Lamellen einer Abdeckung an.',
    },
    cover_set_tilt_position: {
      label: 'Lamellenstellung festlegen',
      description: 'Kippt die Lamellen einer Abdeckung auf eine bestimmte Stellung.',
    },
    lock_lock: {
      label: 'Schloss verriegeln',
      description: 'Verriegelt ein oder mehrere Schlösser.',
    },
    lock_unlock: {
      label: 'Schloss entriegeln',
      description: 'Entriegelt ein oder mehrere Schlösser.',
    },
    lock_open: {
      label: 'Schloss öffnen',
      description: 'Öffnet ein oder mehrere Schlösser, die das Öffnen unterstützen.',
    },
    climate_turn_on: {
      label: 'Thermostat einschalten',
      description: 'Schaltet ein Klimagerät ein.',
    },
    climate_turn_off: {
      label: 'Thermostat ausschalten',
      description: 'Schaltet ein Klimagerät aus.',
    },
    climate_toggle: { label: 'Thermostat umschalten', description: 'Schaltet ein Klimagerät um.' },
    climate_set_temperature: {
      label: 'Thermostat-Zieltemperatur festlegen',
      description: 'Legt die Zieltemperatur eines Klimageräts fest.',
    },
    climate_set_hvac_mode: {
      label: 'Thermostat-Betriebsart festlegen',
      description: 'Legt die Betriebsart (HVAC) eines Klimageräts fest.',
    },
    climate_set_preset_mode: {
      label: 'Thermostat-Voreinstellung festlegen',
      description: 'Legt die Voreinstellung eines Klimageräts fest.',
    },
    climate_set_fan_mode: {
      label: 'Thermostat-Lüftermodus festlegen',
      description: 'Legt den Lüftermodus eines Klimageräts fest.',
    },
    climate_set_swing_mode: {
      label: 'Thermostat-Schwenkmodus festlegen',
      description: 'Legt den Schwenkmodus eines Klimageräts fest.',
    },
    climate_set_humidity: {
      label: 'Thermostat-Zielfeuchtigkeit festlegen',
      description: 'Legt die Zielluftfeuchtigkeit eines Klimageräts fest.',
    },
    mp_turn_on: {
      label: 'Mediaplayer einschalten',
      description: 'Schaltet einen Mediaplayer ein.',
    },
    mp_turn_off: {
      label: 'Mediaplayer ausschalten',
      description: 'Schaltet einen Mediaplayer aus.',
    },
    mp_toggle: { label: 'Mediaplayer umschalten', description: 'Schaltet einen Mediaplayer um.' },
    mp_play: { label: 'Wiedergabe', description: 'Startet die Wiedergabe auf einem Mediaplayer.' },
    mp_pause: {
      label: 'Wiedergabe pausieren',
      description: 'Pausiert die Wiedergabe auf einem Mediaplayer.',
    },
    mp_play_pause: {
      label: 'Wiedergabe/Pause',
      description: 'Wechselt auf einem Mediaplayer zwischen Wiedergabe und Pause.',
    },
    mp_stop: {
      label: 'Wiedergabe stoppen',
      description: 'Stoppt die Wiedergabe auf einem Mediaplayer.',
    },
    mp_next_track: {
      label: 'Nächster Titel',
      description: 'Springt auf einem Mediaplayer zum nächsten Titel.',
    },
    mp_previous_track: {
      label: 'Vorheriger Titel',
      description: 'Springt auf einem Mediaplayer zum vorherigen Titel.',
    },
    mp_volume_up: { label: 'Lauter', description: 'Erhöht die Lautstärke eines Mediaplayers.' },
    mp_volume_down: {
      label: 'Leiser',
      description: 'Verringert die Lautstärke eines Mediaplayers.',
    },
    mp_volume_set: {
      label: 'Lautstärke festlegen',
      description: 'Legt die Lautstärke eines Mediaplayers fest.',
    },
    mp_volume_mute: {
      label: 'Stummschalten/Ton an',
      description: 'Schaltet einen Mediaplayer stumm oder den Ton wieder an.',
    },
    mp_select_source: {
      label: 'Quelle wählen',
      description: 'Wählt die Eingangsquelle eines Mediaplayers.',
    },
    mp_play_media: {
      label: 'Medien abspielen',
      description:
        'Spielt Medien auf einem Mediaplayer ab, etwa eine URL, eine Playlist oder einen Sender.',
    },
    mp_join: {
      label: 'Mediaplayer gruppieren',
      description: 'Fasst Mediaplayer für eine gemeinsame Wiedergabe zusammen.',
    },
    vacuum_start: {
      label: 'Staubsauger starten',
      description: 'Startet die Reinigung oder setzt sie fort.',
    },
    vacuum_pause: {
      label: 'Staubsauger pausieren',
      description: 'Pausiert die aktuelle Aufgabe des Staubsaugers.',
    },
    vacuum_stop: {
      label: 'Staubsauger stoppen',
      description: 'Stoppt die aktuelle Aufgabe des Staubsaugers.',
    },
    vacuum_return_to_base: {
      label: 'Staubsauger zur Station',
      description: 'Schickt den Staubsauger zurück zu seiner Station.',
    },
    vacuum_locate: {
      label: 'Staubsauger orten',
      description: 'Lässt den Staubsauger einen Ton abspielen, damit er gefunden wird.',
    },
    vacuum_clean_spot: {
      label: 'Stelle reinigen',
      description: 'Lässt den Staubsauger einen kleinen Bereich um seine Position reinigen.',
    },
    vacuum_set_fan_speed: {
      label: 'Saugstärke festlegen',
      description: 'Legt die Saugstärke des Staubsaugers fest.',
    },
    humidifier_turn_on: {
      label: 'Luftbefeuchter einschalten',
      description: 'Schaltet einen Luftbefeuchter ein.',
    },
    humidifier_turn_off: {
      label: 'Luftbefeuchter ausschalten',
      description: 'Schaltet einen Luftbefeuchter aus.',
    },
    humidifier_toggle: {
      label: 'Luftbefeuchter umschalten',
      description: 'Schaltet einen Luftbefeuchter um.',
    },
    humidifier_set_humidity: {
      label: 'Luftbefeuchter-Zielfeuchtigkeit festlegen',
      description: 'Legt die Zielluftfeuchtigkeit eines Luftbefeuchters fest.',
    },
    humidifier_set_mode: {
      label: 'Luftbefeuchter-Modus festlegen',
      description: 'Legt den Modus eines Luftbefeuchters fest.',
    },
    valve_open: { label: 'Ventil öffnen', description: 'Öffnet ein Ventil.' },
    valve_close: { label: 'Ventil schließen', description: 'Schließt ein Ventil.' },
    valve_stop: { label: 'Ventil anhalten', description: 'Hält die Bewegung eines Ventils an.' },
    valve_toggle: {
      label: 'Ventil umschalten',
      description: 'Öffnet ein geschlossenes Ventil oder schließt ein offenes.',
    },
    valve_set_position: {
      label: 'Ventilposition festlegen',
      description: 'Fährt ein Ventil auf eine bestimmte Position.',
    },
    siren_turn_on: { label: 'Sirene einschalten', description: 'Schaltet eine Sirene ein.' },
    siren_turn_off: { label: 'Sirene ausschalten', description: 'Schaltet eine Sirene aus.' },
    siren_toggle: { label: 'Sirene umschalten', description: 'Schaltet eine Sirene um.' },
    alarm_arm_away: {
      label: 'Alarm scharf schalten (abwesend)',
      description:
        'Schaltet eine Alarmanlage im Abwesend-Modus scharf. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_arm_home: {
      label: 'Alarm scharf schalten (zu Hause)',
      description:
        'Schaltet eine Alarmanlage im Zuhause-Modus scharf. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_arm_night: {
      label: 'Alarm scharf schalten (Nacht)',
      description:
        'Schaltet eine Alarmanlage im Nachtmodus scharf. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_arm_vacation: {
      label: 'Alarm scharf schalten (Urlaub)',
      description:
        'Schaltet eine Alarmanlage im Urlaubsmodus scharf. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_arm_custom_bypass: {
      label: 'Alarm scharf schalten (mit Ausnahmen)',
      description:
        'Schaltet eine Alarmanlage scharf und lässt bestimmte Zonen aus. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_disarm: {
      label: 'Alarm unscharf schalten',
      description:
        'Schaltet eine Alarmanlage unscharf. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    alarm_trigger: {
      label: 'Alarm auslösen',
      description:
        'Löst eine Alarmanlage von Hand aus. Wahlweise mit Code, falls die Anlage einen verlangt.',
    },
    remote_turn_on: {
      label: 'Fernbedienung einschalten',
      description: 'Schaltet eine Fernbedienung ein.',
    },
    remote_turn_off: {
      label: 'Fernbedienung ausschalten',
      description: 'Schaltet eine Fernbedienung aus.',
    },
    remote_toggle: {
      label: 'Fernbedienung umschalten',
      description: 'Schaltet eine Fernbedienung um.',
    },
    remote_send_command: {
      label: 'Befehl senden',
      description: 'Sendet einen Befehl über eine Fernbedienung.',
    },
    remote_learn_command: {
      label: 'Befehl anlernen',
      description: 'Bringt einer Fernbedienung einen neuen Befehl bei.',
    },
    select_select_option: {
      label: 'Option wählen',
      description: 'Wählt eine Option einer Auswahl.',
    },
    select_select_next: {
      label: 'Nächste Option wählen',
      description: 'Wählt die nächste Option einer Auswahl.',
    },
    select_select_previous: {
      label: 'Vorherige Option wählen',
      description: 'Wählt die vorherige Option einer Auswahl.',
    },
    select_select_first: {
      label: 'Erste Option wählen',
      description: 'Wählt die erste Option einer Auswahl.',
    },
    select_select_last: {
      label: 'Letzte Option wählen',
      description: 'Wählt die letzte Option einer Auswahl.',
    },
    text_set_value: {
      label: 'Text festlegen',
      description: 'Legt den Wert einer Text-Entität fest.',
    },
    water_heater_turn_on: {
      label: 'Warmwasserbereiter einschalten',
      description: 'Schaltet einen Warmwasserbereiter ein.',
    },
    water_heater_turn_off: {
      label: 'Warmwasserbereiter ausschalten',
      description: 'Schaltet einen Warmwasserbereiter aus.',
    },
    water_heater_set_temperature: {
      label: 'Warmwasser-Temperatur festlegen',
      description: 'Legt die Zieltemperatur eines Warmwasserbereiters fest.',
    },
    water_heater_set_operation_mode: {
      label: 'Warmwasser-Betriebsart festlegen',
      description: 'Legt die Betriebsart eines Warmwasserbereiters fest.',
    },
    counter_increment: {
      label: 'Zähler erhöhen',
      description: 'Erhöht einen Zähler um seine Schrittweite.',
    },
    counter_decrement: {
      label: 'Zähler verringern',
      description: 'Verringert einen Zähler um seine Schrittweite.',
    },
    counter_reset: {
      label: 'Zähler zurücksetzen',
      description: 'Setzt einen Zähler auf seinen Anfangswert zurück.',
    },
    counter_set_value: {
      label: 'Zählerwert festlegen',
      description: 'Setzt einen Zähler auf einen bestimmten Wert.',
    },
    todo_add_item: {
      label: 'Aufgabe hinzufügen',
      description: 'Fügt einer Aufgabenliste einen neuen Eintrag hinzu.',
    },
    todo_update_item: {
      label: 'Aufgabe ändern',
      description: 'Ändert einen vorhandenen Eintrag einer Aufgabenliste.',
    },
    todo_remove_item: {
      label: 'Aufgabe entfernen',
      description: 'Entfernt einen Eintrag aus einer Aufgabenliste.',
    },
    todo_remove_completed_items: {
      label: 'Erledigte Aufgaben entfernen',
      description: 'Entfernt alle erledigten Einträge aus einer Aufgabenliste.',
    },
    lawn_mower_start_mowing: {
      label: 'Rasenmäher starten',
      description: 'Startet das Mähen oder setzt es fort.',
    },
    lawn_mower_pause: {
      label: 'Rasenmäher pausieren',
      description: 'Pausiert die aktuelle Aufgabe eines Rasenmähers.',
    },
    lawn_mower_dock: {
      label: 'Rasenmäher zur Station',
      description: 'Schickt einen Rasenmäher zurück zu seiner Station.',
    },
    timer_start: { label: 'Timer starten', description: 'Startet einen Timer.' },
    timer_pause: { label: 'Timer pausieren', description: 'Pausiert einen Timer.' },
    timer_cancel: { label: 'Timer abbrechen', description: 'Bricht einen Timer ab.' },
    timer_finish: { label: 'Timer beenden', description: 'Beendet einen Timer vorzeitig.' },
    scene_turn_on: { label: 'Szene aktivieren', description: 'Aktiviert eine Szene.' },
    button_press: { label: 'Taste drücken', description: 'Drückt eine Tasten-Entität.' },
    camera_turn_on: { label: 'Kamera einschalten', description: 'Schaltet eine Kamera ein.' },
    camera_turn_off: { label: 'Kamera ausschalten', description: 'Schaltet eine Kamera aus.' },
    camera_snapshot: {
      label: 'Kamera-Schnappschuss aufnehmen',
      description: 'Nimmt einen Schnappschuss einer Kamera auf.',
    },
    camera_record: {
      label: 'Kamerabild aufzeichnen',
      description: 'Zeichnet das Livebild einer Kamera auf.',
    },
    camera_enable_motion_detection: {
      label: 'Bewegungserkennung der Kamera einschalten',
      description: 'Schaltet die Bewegungserkennung einer Kamera ein.',
    },
    camera_disable_motion_detection: {
      label: 'Bewegungserkennung der Kamera ausschalten',
      description: 'Schaltet die Bewegungserkennung einer Kamera aus.',
    },
    calendar_create_event: {
      label: 'Kalendertermin erstellen',
      description: 'Fügt einem Kalender einen neuen Termin hinzu.',
    },
    ai_task_generate_data: {
      label: 'Daten erzeugen',
      description:
        'Lässt eine KI eine Aufgabe ausführen, die Daten erzeugt, etwa Text oder strukturierte Ausgaben.',
    },
    ai_task_generate_image: {
      label: 'Bild erzeugen',
      description: 'Lässt eine KI ein Bild nach Anweisungen erzeugen.',
    },
    assist_satellite_announce: {
      label: 'Auf Satellit ansagen',
      description: 'Sagt eine Nachricht auf einem Assist-Satelliten an.',
    },
    assist_satellite_ask_question: {
      label: 'Auf Satellit fragen',
      description: 'Stellt auf einem Assist-Satelliten eine Frage und nimmt die Antwort entgegen.',
    },
    assist_satellite_start_conversation: {
      label: 'Gespräch auf Satellit beginnen',
      description: 'Beginnt ein Gespräch über einen Assist-Satelliten.',
    },
    conversation_process: {
      label: 'Text verarbeiten',
      description: 'Sendet Text zur Verarbeitung an einen Konversationsagenten.',
    },
    conversation_reload: {
      label: 'Konversationsagenten neu laden',
      description: 'Lädt die Intent-Konfiguration der Konversationsagenten neu.',
    },
    date_set_value: {
      label: 'Datum festlegen',
      description: 'Legt den Wert einer Datums-Entität fest.',
    },
    datetime_set_value: {
      label: 'Datum/Uhrzeit festlegen',
      description: 'Legt den Wert einer Datum/Uhrzeit-Entität fest.',
    },
    device_tracker_update_entity: {
      label: 'Geräteverfolgung aktualisieren',
      description:
        'Fordert sofort eine Aktualisierung der Geräteverfolgung an, statt auf die nächste planmäßige zu warten.',
    },
    group_set: {
      label: 'Gruppe festlegen',
      description: 'Erstellt oder ändert eine Gruppe im alten Stil.',
    },
    group_remove: { label: 'Gruppe entfernen', description: 'Entfernt eine Gruppe im alten Stil.' },
    group_reload: {
      label: 'Gruppen neu laden',
      description: 'Lädt die Gruppen aus der YAML-Konfiguration neu.',
    },
    update_install: {
      label: 'Update installieren',
      description: 'Installiert ein Update für ein Gerät oder einen Dienst.',
    },
    update_skip: {
      label: 'Update überspringen',
      description: 'Überspringt ein verfügbares Update.',
    },
    update_clear_skipped: {
      label: 'Übersprungenes Update zurücksetzen',
      description: 'Hebt das Überspringen eines Updates auf.',
    },
    number_set_value: {
      label: 'Zahlenwert festlegen',
      description: 'Legt den Wert einer Zahlen-Entität fest.',
    },
    input_boolean_turn_on: {
      label: 'Schalter-Helfer einschalten',
      description: 'Schaltet einen input_boolean-Helfer ein.',
    },
    input_boolean_turn_off: {
      label: 'Schalter-Helfer ausschalten',
      description: 'Schaltet einen input_boolean-Helfer aus.',
    },
    input_boolean_toggle: {
      label: 'Schalter-Helfer umschalten',
      description: 'Schaltet einen input_boolean-Helfer um.',
    },
    input_button_press: {
      label: 'Tasten-Helfer drücken',
      description: 'Drückt einen input_button-Helfer.',
    },
    input_number_set_value: {
      label: 'Zahlen-Helfer festlegen',
      description: 'Legt den Wert eines input_number-Helfers fest.',
    },
    input_number_increment: {
      label: 'Zahlen-Helfer erhöhen',
      description: 'Erhöht den Wert eines input_number-Helfers um seine Schrittweite.',
    },
    input_number_decrement: {
      label: 'Zahlen-Helfer verringern',
      description: 'Verringert den Wert eines input_number-Helfers um seine Schrittweite.',
    },
    input_select_select_option: {
      label: 'Option des Dropdown-Helfers wählen',
      description: 'Wählt eine Option eines input_select-Helfers.',
    },
    input_select_select_next: {
      label: 'Nächste Option des Dropdown-Helfers wählen',
      description: 'Wählt die nächste Option eines input_select-Helfers.',
    },
    input_select_select_previous: {
      label: 'Vorherige Option des Dropdown-Helfers wählen',
      description: 'Wählt die vorherige Option eines input_select-Helfers.',
    },
    input_select_select_first: {
      label: 'Erste Option des Dropdown-Helfers wählen',
      description: 'Wählt die erste Option eines input_select-Helfers.',
    },
    input_select_select_last: {
      label: 'Letzte Option des Dropdown-Helfers wählen',
      description: 'Wählt die letzte Option eines input_select-Helfers.',
    },
    input_text_set_value: {
      label: 'Text-Helfer festlegen',
      description: 'Legt den Wert eines input_text-Helfers fest.',
    },
    input_datetime_set_datetime: {
      label: 'Datum/Uhrzeit-Helfer festlegen',
      description: 'Legt Datum und/oder Uhrzeit eines input_datetime-Helfers fest.',
    },
    notify_send_message: {
      label: 'Benachrichtigung senden',
      description:
        'Sendet eine Benachrichtigung über einen eingerichteten Benachrichtigungsdienst (Mobile App, E-Mail, Chat, ...).',
    },
  },
};

/** The catalog's texts per language; English is the catalog itself. */
const BY_LANGUAGE: Readonly<Record<string, ActionCatalogTexts>> = { de: DE };

/** The catalog texts for a language (`de-AT` reads as `de`), or none. */
export function actionCatalogTexts(language: string): ActionCatalogTexts | undefined {
  return BY_LANGUAGE[language.split('-')[0]?.toLowerCase() ?? ''];
}

/**
 * The Then picker's catalog in the editor's language: Circuitry's own
 * headings and actions translated where the language has them. The
 * services HA has that the catalog doesn't (`discovered:...`) keep HA's
 * own wording.
 */
export function localizedActionCatalog(
  categories: readonly EntityActionCategory[],
  language: string
): EntityActionCategory[] {
  const texts = actionCatalogTexts(language);
  if (!texts) return [...categories];
  return categories.map((category) => {
    // A heading that is the domain's name is the device actions' heading
    // too, and the by-room results list both under it, so it is that
    // name in this language as well; the catalog's own headings are
    // translated here.
    const shared = EN_DOMAIN_NAMES[category.domain] === category.heading;
    const heading =
      (shared ? texts.domainNames[category.domain] : texts.headings[category.domain]) ??
      category.heading;
    return {
      ...category,
      heading,
      label: heading,
      recipes: category.recipes.map((recipe) => {
        const text = texts.actions[recipe.id];
        return text ? { ...recipe, label: text.label, description: text.description } : recipe;
      }),
    };
  });
}
