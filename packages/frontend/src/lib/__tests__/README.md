# Automation Import/Export Test Framework

## Overview

A comprehensive test framework for validating roundtrip data integrity between Home Assistant YAML automations and the visual flow editor.

## Test Results Summary

### ✅ Passing Tests (5/6)

1. **01-simple-trigger-action.yaml** ✅ - Basic trigger → action flow
2. **02-knx-complex.yaml** ✅ - Complex KNX device automation with if/then/else
3. **03-multiple-conditions.yaml** ✅ - Multiple top-level conditions with choose structures
4. **04-choose-with-default.yaml** ✅ - Choose structures with default branches
5. **05-delays-and-waits.yaml** ✅ - Sequential actions with delays and wait conditions

### ❌ Known Issues (1/6)

6. **06-multiple-triggers.yaml** ❌ - Multiple triggers (transpiler limitation)

## Framework Features

### Test Structure

- **Fixtures Directory**: `src/lib/__tests__/fixtures/` - Contains YAML test cases
- **Automated Testing**: Discovers all YAML files and runs roundtrip tests
- **Comprehensive Validation**: Tests nodes, edges, data preservation, and visual layout

### What Gets Tested

#### Node Generation

- ✅ Correct node types (trigger, condition, action, delay, wait)
- ✅ Proper positioning with branch offsets
- ✅ Data preservation across conversion

#### Edge Validation

- ✅ Proper sourceHandle values ('true', 'false', null)
- ✅ Valid connections between nodes
- ✅ No orphaned nodes

#### Data Integrity

- ✅ Alias preservation
- ✅ Service configurations
- ✅ Target entity preservation
- ✅ Custom properties (KNX, device IDs, etc.)
- ✅ Mode and execution settings

#### YAML Roundtrip

- ✅ Valid YAML output
- ✅ CAFE metadata injection
- ✅ Functional automation structure

## Key Achievements

### Fixed Issues Through Testing

1. **sourceHandle Bug**: Fixed undefined sourceHandle values for condition nodes
2. **Top-level Conditions**: Properly connected with 'true' sourceHandle (AND logic)
3. **Choose Structures**: Correct 'true'/'false' branching
4. **Vertical Branching**: Visual separation for condition branches (when both exist)
5. **Property Preservation**: Complex device properties like KNX configurations

### Visual Improvements

- **Vertical Branch Offset**: 150px separation between then/else branches
- **Sequential Layout**: Proper horizontal progression of nodes
- **Node Type Detection**: Automatic detection of delay, wait, action types

## Adding New Test Cases

Simply add a new YAML file to `fixtures/` directory:

```yaml
alias: My Test Automation
description: Test description
trigger:
  - platform: state
    entity_id: sensor.test
action:
  - service: light.turn_on
mode: single
```

The test will automatically be picked up and validated.

## Usage

```bash
# Run all roundtrip tests
yarn test src/lib/__tests__/roundtrip-integration.test.ts

# Run specific test
yarn test src/lib/__tests__/roundtrip-integration.test.ts -t "simple-trigger"

# Run with detailed output
yarn test src/lib/__tests__/roundtrip-integration.test.ts --reporter=verbose
```

## Next Steps

1. **Fix Multiple Triggers**: Improve handling of multiple trigger scenarios
2. **Add More Patterns**: Cover additional Home Assistant automation patterns
3. **Performance Testing**: Add tests for large/complex automations
4. **Error Handling**: Test malformed YAML handling
5. **Documentation**: Generate docs from test cases
