import { YamlParser } from './parser/YamlParser';

const yaml = `
alias: Kitchen Light
description: ""
triggers:
  - trigger: state
    entity_id:
      - binary_sensor.occupancy_1
      - binary_sensor.occupancy_2
    to: "on"
actions:
  - choose:
      - conditions:
          - condition: sun
            after: sunset
          - condition: time
            before: "23:58:00"
        sequence:
          - service: light.turn_on
            target:
              entity_id: light.kitchen
          - wait_for_trigger:
              - trigger: state
                entity_id: binary_sensor.kitchen_presence
                to: "off"
          - delay:
              seconds: 15
          - service: light.turn_off
            target:
              entity_id: light.kitchen
      - conditions:
          - condition: sun
            after: sunrise
          - condition: time
            after: "00:00:00"
        sequence:
          - service: light.turn_on
            target:
              entity_id: light.kitchen
          - wait_for_trigger:
              - trigger: state
                entity_id: binary_sensor.kitchen_presence
                to: "off"
          - delay:
              seconds: 15
          - service: light.turn_off
            target:
              entity_id: light.kitchen
mode: single
`;

const parser = new YamlParser();
parser.parse(yaml).then((result) => {
  console.log('success:', result.success);
  console.log('warnings:', JSON.stringify(result.warnings, null, 2));
  console.log('errors:', JSON.stringify(result.errors, null, 2));
  if (result.graph) {
    for (const n of result.graph.nodes) {
      console.log(n.id, n.type, JSON.stringify(n.data));
    }
    console.log('---edges---');
    for (const e of result.graph.edges) {
      console.log(e.id, e.source, '->', e.target, e.sourceHandle ?? '');
    }
  }
});
