# Third-Party Notices

This file lists the open-source packages bundled into the built Circuitry
frontend (`custom_components/circuitry/www/`), produced by
`.github/workflows/release.yml` and distributed in each GitHub Release
(`circuitry.zip` / `circuitry.tar.gz`), together with their licenses.

This covers **runtime dependencies only** — build-time-only tools
(TypeScript, Vite, Vitest, test libraries, linters, etc.) are never shipped
in the built output and are not included here.

Generated from a resolved install of the runtime dependency tree (39 direct
dependencies, 183 packages including transitive dependencies) using
`license-checker-rseidelsohn`. Each copyright line was read directly from
that package's own shipped `LICENSE` file where one exists; the four
packages that ship no `LICENSE` file are noted individually below.

## License summary

| License | Packages |
|---|---|
| MIT | 158 |
| ISC | 11 |
| BSD-3-Clause | 7 |
| Apache-2.0 | 3 |
| Python-2.0 | 1 |
| EPL-2.0 | 1 |
| BSD-2-Clause | 1 |
| 0BSD | 1 |

None of the licenses used by any runtime dependency are copyleft in a way
that affects Circuitry's own licensing — all are permissive (MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0, Python-2.0, 0BSD) or, in the case of
elkjs, the file-level weak-copyleft EPL-2.0, which does not require
relicensing a combined work when used as an unmodified library dependency.

## Package list

| Package | License | Copyright | Source |
|---|---|---|---|
| `@babel/runtime@7.29.7` | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | https://github.com/babel/babel |
| `@floating-ui/core@1.8.0` | MIT | Copyright (c) 2021-present Floating UI contributors | https://github.com/floating-ui/floating-ui |
| `@floating-ui/dom@1.8.0` | MIT | Copyright (c) 2021-present Floating UI contributors | https://github.com/floating-ui/floating-ui |
| `@floating-ui/react-dom@2.1.9` | MIT | Copyright (c) 2021-present Floating UI contributors | https://github.com/floating-ui/floating-ui |
| `@floating-ui/utils@0.2.12` | MIT | Copyright (c) 2021-present Floating UI contributors | https://github.com/floating-ui/floating-ui |
| `@formatjs/fast-memoize@3.1.7` | MIT | Copyright (c) 2023 FormatJS | https://github.com/formatjs/formatjs |
| `@formatjs/icu-messageformat-parser@3.5.18` | MIT | Copyright (c) 2023 FormatJS | https://github.com/formatjs/formatjs |
| `@formatjs/icu-skeleton-parser@2.1.11` | MIT | Copyright (c) 2023 FormatJS | https://github.com/formatjs/formatjs |
| `@formatjs/intl-utils@3.8.4` | MIT | Copyright (c) 2019 FormatJS | https://github.com/formatjs/formatjs |
| `@hookform/resolvers@5.9.1` | MIT | Copyright (c) 2019-present Beier(Bill) Luo | https://github.com/react-hook-form/resolvers |
| `@lit-labs/ssr-dom-shim@1.6.0` | BSD-3-Clause | (license declared as BSD-3-Clause in package.json; no LICENSE file bundled with this package — see lit.dev) | https://github.com/lit/lit |
| `@lit/reactive-element@2.1.2` | BSD-3-Clause | Copyright (c) 2017 Google LLC. All rights reserved. | https://github.com/lit/lit |
| `@radix-ui/number@1.1.3` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/primitive@1.1.7` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-arrow@1.1.15` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-checkbox@1.3.11` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-collapsible@1.1.20` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-collection@1.1.15` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-compose-refs@1.1.5` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-context@1.2.2` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-dialog@1.1.23` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-direction@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-dismissable-layer@1.1.19` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-dropdown-menu@2.1.24` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-focus-guards@1.1.6` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-focus-scope@1.1.16` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-id@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-label@2.1.15` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-menu@2.1.24` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-popover@1.1.23` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-popper@1.3.7` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-portal@1.1.17` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-presence@1.1.10` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-primitive@2.1.10` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-roving-focus@1.1.19` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-select@2.3.7` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-separator@1.1.15` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-slider@1.4.7` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-slot@1.3.3` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-switch@1.3.7` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-tabs@1.1.21` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-tooltip@1.2.16` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-callback-ref@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-controllable-state@1.2.6` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-effect-event@0.0.5` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-is-hydrated@0.1.3` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-layout-effect@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-previous@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-rect@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-use-size@1.1.4` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/react-visually-hidden@1.2.11` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@radix-ui/rect@1.1.3` | MIT | Copyright (c) 2022 WorkOS | https://github.com/radix-ui/primitives |
| `@standard-schema/utils@0.3.0` | MIT | Copyright (c) 2024 Fabian Hiller | https://github.com/standard-schema/standard-schema |
| `@types/d3-color@3.1.3` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/d3-drag@3.0.7` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/d3-interpolate@3.0.4` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/d3-selection@3.0.12` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/d3-transition@3.0.9` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/d3-zoom@3.0.8` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/hast@2.3.10` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/hast@3.0.5` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/mdast@4.0.4` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/prismjs@1.26.6` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/trusted-types@2.0.7` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/unist@2.0.11` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/unist@3.0.3` | MIT | Copyright (c) Microsoft Corporation. | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@uiw/react-textarea-code-editor@3.1.1` | MIT | (license declared as MIT in package.json; no LICENSE file bundled with this package) | https://github.com/uiwjs/react-textarea-code-editor |
| `@ungap/structured-clone@1.4.0` | ISC | Copyright (c) 2021, Andrea Giammarchi, @WebReflection | https://github.com/ungap/structured-clone |
| `@xyflow/react@12.11.6` | MIT | Copyright (c) 2019-2025 webkid GmbH | https://github.com/xyflow/xyflow |
| `@xyflow/system@0.0.82` | MIT | Copyright (c) 2019-2025 webkid GmbH | https://github.com/xyflow/xyflow |
| `argparse@2.0.1` | Python-2.0 | Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, | https://github.com/nodeca/argparse |
| `aria-hidden@1.2.6` | MIT | Copyright (c) 2017 Anton Korzunov | https://github.com/theKashey/aria-hidden |
| `bail@2.0.2` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/bail |
| `ccount@2.0.1` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/ccount |
| `character-entities-html4@2.1.0` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/character-entities-html4 |
| `character-entities-legacy@3.0.0` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/character-entities-legacy |
| `character-entities@2.0.2` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/character-entities |
| `character-reference-invalid@2.0.1` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/character-reference-invalid |
| `class-variance-authority@0.7.1` | Apache-2.0 | Copyright License. Subject to the terms and conditions of | https://github.com/joe-bell/cva |
| `classcat@5.0.5` | MIT | Copyright © Jorge Bucaran <<https://jorgebucaran.com>> | https://github.com/jorgebucaran/classcat |
| `clsx@2.1.1` | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) | https://github.com/lukeed/clsx |
| `cmdk@1.1.1` | MIT | Copyright (c) 2022 Paco Coursey | https://github.com/pacocoursey/cmdk |
| `comma-separated-tokens@2.0.3` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/comma-separated-tokens |
| `commander@15.0.0` | MIT | Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> | https://github.com/tj/commander.js |
| `custom-card-helpers@2.0.0` | MIT | Copyright (c) 2019 Custom cards for Home Assistant | https://github.com/custom-cards/custom-card-helpers |
| `d3-color@3.1.0` | ISC | Copyright 2010-2022 Mike Bostock | https://github.com/d3/d3-color |
| `d3-dispatch@3.0.1` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-dispatch |
| `d3-drag@3.0.0` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-drag |
| `d3-ease@3.0.1` | BSD-3-Clause | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-ease |
| `d3-interpolate@3.0.1` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-interpolate |
| `d3-selection@3.0.0` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-selection |
| `d3-timer@3.0.1` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-timer |
| `d3-transition@3.0.1` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-transition |
| `d3-zoom@3.0.0` | ISC | Copyright 2010-2021 Mike Bostock | https://github.com/d3/d3-zoom |
| `decode-named-character-reference@1.3.0` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/decode-named-character-reference |
| `dequal@2.0.3` | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) | https://github.com/lukeed/dequal |
| `detect-node-es@1.1.0` | MIT | Copyright (c) 2017 Ilya Kantor | https://github.com/thekashey/detect-node |
| `devlop@1.1.0` | MIT | Copyright (c) 2023 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/devlop |
| `elkjs@0.11.1` | EPL-2.0 | (EPL-2.0 agreement text; no per-file copyright header — see kieler/elkjs, an Eclipse Foundation / Kiel University project) | https://github.com/kieler/elkjs |
| `emojis-list@3.0.0` | MIT | Copyright © 2015 Kiko Beats | https://github.com/kikobeats/emojis-list |
| `entities@6.0.1` | BSD-2-Clause | Copyright (c) Felix Böhm | https://github.com/fb55/entities |
| `extend@3.0.2` | MIT | Copyright (c) 2014 Stefan Thomas | https://github.com/justmoon/node-extend |
| `fuse.js@7.5.0` | Apache-2.0 | Copyright License. Subject to the terms and conditions of | https://github.com/krisk/Fuse |
| `get-nonce@1.0.1` | MIT | Copyright (c) 2020 Anton Korzunov | https://github.com/theKashey/get-nonce |
| `graphlib@2.1.8` | MIT | Copyright (c) 2012-2014 Chris Pettitt | https://github.com/dagrejs/graphlib |
| `hast-util-from-html@2.0.3` | MIT | Copyright (c) 2022 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-from-html |
| `hast-util-from-parse5@8.0.3` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-from-parse5 |
| `hast-util-parse-selector@3.1.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-parse-selector |
| `hast-util-parse-selector@4.0.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-parse-selector |
| `hast-util-to-html@9.0.5` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-to-html |
| `hast-util-to-string@3.0.1` | MIT | Copyright (c) Titus Wormer | https://github.com/rehypejs/rehype-minify.git#main |
| `hast-util-whitespace@3.0.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hast-util-whitespace |
| `hastscript@7.2.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hastscript |
| `hastscript@9.0.1` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/hastscript |
| `home-assistant-js-websocket@9.7.0` | Apache-2.0 | Copyright License | https://github.com/home-assistant/home-assistant-js-websocket |
| `html-parse-stringify@4.0.1` | MIT | Copyright (c) 2025 Henrik Joreteg <henrik@joreteg.com> | https://github.com/i18next/html-parse-stringify |
| `html-void-elements@3.0.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/html-void-elements |
| `i18next@26.4.2` | MIT | Copyright (c) 2011-present i18next | https://github.com/i18next/i18next |
| `intl-messageformat@11.2.15` | BSD-3-Clause | Copyright (c) 2023, Oath Inc. | https://github.com/formatjs/formatjs |
| `is-alphabetical@2.0.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/is-alphabetical |
| `is-alphanumerical@2.0.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/is-alphanumerical |
| `is-decimal@2.0.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/is-decimal |
| `is-hexadecimal@2.0.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/is-hexadecimal |
| `is-plain-obj@4.1.0` | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) | https://github.com/sindresorhus/is-plain-obj |
| `js-yaml@4.3.2` | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin | https://github.com/nodeca/js-yaml |
| `lit-element@4.2.2` | BSD-3-Clause | Copyright (c) 2017 Google LLC. All rights reserved. | https://github.com/lit/lit |
| `lit-html@3.3.3` | BSD-3-Clause | Copyright (c) 2017 Google LLC. All rights reserved. | https://github.com/lit/lit |
| `lit@3.3.3` | BSD-3-Clause | Copyright (c) 2017 Google LLC. All rights reserved. | https://github.com/lit/lit |
| `lodash@4.18.1` | MIT | Copyright OpenJS Foundation and other contributors <https://openjsf.org/> | https://github.com/lodash/lodash |
| `lucide-react@1.47.0` | ISC | Copyright (c) 2026 Lucide Icons and Contributors | https://github.com/lucide-icons/lucide |
| `mdast-util-to-hast@13.2.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/mdast-util-to-hast |
| `micromark-util-character@2.1.1` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/micromark/micromark.git#main |
| `micromark-util-encode@2.0.1` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/micromark/micromark.git#main |
| `micromark-util-sanitize-uri@2.0.1` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/micromark/micromark.git#main |
| `micromark-util-symbol@2.0.1` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/micromark/micromark.git#main |
| `micromark-util-types@2.0.2` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/micromark/micromark.git#main |
| `parse-entities@4.0.2` | MIT | Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com> | https://github.com/wooorm/parse-entities |
| `parse-numeric-range@1.3.0` | ISC | Copyright (c) 2014, Euank <euank@euank.com> | https://github.com/euank/node-parse-numeric-range |
| `parse5@7.3.0` | MIT | Copyright (c) 2013-2019 Ivan Nikulin (ifaaan@gmail.com, https://github.com/inikulin) | https://github.com/inikulin/parse5 |
| `property-information@6.5.0` | MIT | Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com> | https://github.com/wooorm/property-information |
| `property-information@7.2.0` | MIT | Copyright (c) Titus Wormer <mailto:tituswormer@gmail.com> | https://github.com/wooorm/property-information |
| `react-dom@19.3.0` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| `react-error-boundary@6.1.6` | MIT | Copyright (c) 2020 Brian Vaughn | https://github.com/bvaughn/react-error-boundary |
| `react-hook-form@7.88.0` | MIT | Copyright (c) 2019-present Beier(Bill) Luo | https://github.com/react-hook-form/react-hook-form |
| `react-i18next@17.0.15` | MIT | Copyright (c) 2015-present i18next | https://github.com/i18next/react-i18next |
| `react-remove-scroll-bar@2.3.8` | MIT | (license declared as MIT in package.json; no LICENSE file bundled with this package) | https://github.com/theKashey/react-remove-scroll-bar |
| `react-remove-scroll@2.7.2` | MIT | Copyright (c) 2017 Anton Korzunov | https://github.com/theKashey/react-remove-scroll |
| `react-style-singleton@2.2.3` | MIT | Copyright (c) 2017 Anton Korzunov | https://github.com/theKashey/react-style-singleton |
| `react@19.3.0` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| `refractor@4.9.0` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/refractor |
| `rehype-parse@9.0.1` | MIT | Copyright (c) Titus Wormer | https://github.com/rehypejs/rehype.git#main |
| `rehype-prism-plus@2.0.0` | MIT | Copyright (c) 2021 Timothy | https://github.com/timlrx/rehype-prism-plus |
| `rehype-stringify@10.0.1` | MIT | Copyright (c) Titus Wormer | https://github.com/rehypejs/rehype.git#main |
| `rehype@13.0.2` | MIT | Copyright (c) Titus Wormer | https://github.com/rehypejs/rehype.git#main |
| `scheduler@0.28.0` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| `sonner@2.0.8` | MIT | Copyright (c) 2023 Emil Kowalski | https://github.com/emilkowalski/sonner |
| `space-separated-tokens@2.0.2` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/space-separated-tokens |
| `stringify-entities@4.0.4` | MIT | Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com> | https://github.com/wooorm/stringify-entities |
| `superstruct@2.0.2` | MIT | Copyright &copy; 2017, [Ian Storm Taylor](https://ianstormtaylor.com) | https://github.com/ianstormtaylor/superstruct |
| `tailwind-merge@3.7.0` | MIT | Copyright (c) 2021 Dany Castillo | https://github.com/dcastil/tailwind-merge |
| `trim-lines@3.0.1` | MIT | Copyright (c) 2015 Titus Wormer <mailto:tituswormer@gmail.com> | https://github.com/wooorm/trim-lines |
| `trough@2.2.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/trough |
| `tslib@2.8.1` | 0BSD | Copyright (c) Microsoft Corporation. | https://github.com/Microsoft/tslib |
| `unified@11.0.5` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/unifiedjs/unified |
| `unist-util-filter@5.0.1` | MIT | Copyright (c) 2016 Eugene Sharygin | https://github.com/syntax-tree/unist-util-filter |
| `unist-util-is@6.0.1` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/unist-util-is |
| `unist-util-position@5.0.0` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/unist-util-position |
| `unist-util-stringify-position@4.0.0` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/unist-util-stringify-position |
| `unist-util-visit-parents@6.0.2` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/unist-util-visit-parents |
| `unist-util-visit@5.1.0` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/syntax-tree/unist-util-visit |
| `use-callback-ref@1.3.3` | MIT | Copyright (c) 2017 Anton Korzunov | https://github.com/theKashey/use-callback-ref |
| `use-sidecar@1.1.3` | MIT | Copyright (c) 2017 Anton Korzunov | https://github.com/theKashey/use-sidecar |
| `use-sync-external-store@1.7.0` | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| `uuid@14.0.2` | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors | https://github.com/uuidjs/uuid |
| `vfile-location@5.0.3` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/vfile/vfile-location |
| `vfile-message@4.0.3` | MIT | Copyright (c) Titus Wormer <tituswormer@gmail.com> | https://github.com/vfile/vfile-message |
| `vfile@6.0.3` | MIT | Copyright (c) 2015 Titus Wormer <tituswormer@gmail.com> | https://github.com/vfile/vfile |
| `web-namespaces@2.0.1` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/web-namespaces |
| `zod@4.6.5` | MIT | Copyright (c) 2025 Colin McDonnell | https://github.com/colinhacks/zod |
| `zundo@2.3.0` | MIT | Copyright (c) 2021 Charles Kornoelje | https://github.com/charkour/zundo |
| `zustand@4.5.7` | MIT | Copyright (c) 2019 Paul Henschel | https://github.com/pmndrs/zustand |
| `zustand@5.0.15` | MIT | Copyright (c) 2019 Paul Henschel | https://github.com/pmndrs/zustand |
| `zwitch@2.0.4` | MIT | Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com> | https://github.com/wooorm/zwitch |

## Full license texts

One copy of each distinct license text used above (as published by the
[SPDX License List](https://spdx.org/licenses/)), with the per-package
copyright holder given in the table rather than repeated per package.
Apache-2.0 is not repeated here — it's already reproduced in full in this
repository's own `LICENSE` file.

### MIT

```
MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### ISC

```
ISC License

Copyright <year> <owner>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### BSD-2-Clause

```
Copyright (c) <year> <owner>

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause

```
Copyright (c) <year> <owner>.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### 0BSD

```
Copyright (C) <year> by <author> <email>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Python-2.0 (argparse)

```
PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2

     1. This LICENSE AGREEMENT is between the Python Software Foundation ("PSF"), and the Individual or Organization ("Licensee") accessing and otherwise using this software ("Python") in source or binary form and its associated documentation.

     2. Subject to the terms and conditions of this License Agreement, PSF hereby grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce, analyze, test, perform and/or display publicly, prepare derivative works, distribute, and otherwise use Python alone or in any derivative version, provided, however, that PSF's License Agreement and PSF's notice of copyright, i.e., "Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006 Python Software Foundation; All Rights Reserved" are retained in Python alone or in any derivative version prepared by Licensee.

     3. In the event Licensee prepares a derivative work that is based on or incorporates Python or any part thereof, and wants to make the derivative work available to others as provided herein, then Licensee hereby agrees to include in any such work a brief summary of the changes made to Python.

     4. PSF is making Python available to Licensee on an "AS IS" basis. PSF MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PSF MAKES NO AND DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON WILL NOT INFRINGE ANY THIRD PARTY RIGHTS.

     5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS A RESULT OF MODIFYING, DISTRIBUTING, OR OTHERWISE USING PYTHON, OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

     6. This License Agreement will automatically terminate upon a material breach of its terms and conditions.

     7. Nothing in this License Agreement shall be deemed to create any relationship of agency, partnership, or joint venture between PSF and Licensee. This License Agreement does not grant permission to use PSF trademarks or trade name in a trademark sense to endorse or promote products or services of Licensee, or any third party.

     8. By copying, installing or otherwise using Python, Licensee agrees to be bound by the terms and conditions of this License Agreement.


BEOPEN.COM LICENSE AGREEMENT FOR PYTHON 2.0

BEOPEN PYTHON OPEN SOURCE LICENSE AGREEMENT VERSION 1

     1. This LICENSE AGREEMENT is between BeOpen.com ("BeOpen"), having an office at 160 Saratoga Avenue, Santa Clara, CA 95051, and the Individual or Organization ("Licensee") accessing and otherwise using this software in source or binary form and its associated documentation ("the Software").

     2. Subject to the terms and conditions of this BeOpen Python License Agreement, BeOpen hereby grants Licensee a non-exclusive, royalty-free, world-wide license to reproduce, analyze, test, perform and/or display publicly, prepare derivative works, distribute, and otherwise use the Software alone or in any derivative version, provided, however, that the BeOpen Python License is retained in the Software, alone or in any derivative version prepared by Licensee.

     3. BeOpen is making the Software available to Licensee on an "AS IS" basis. BEOPEN MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, BEOPEN MAKES NO AND DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE WILL NOT INFRINGE ANY THIRD PARTY RIGHTS.

     4. BEOPEN SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF THE SOFTWARE FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS A RESULT OF USING, MODIFYING OR DISTRIBUTING THE SOFTWARE, OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

     5. This License Agreement will automatically terminate upon a material breach of its terms and conditions.

     6. This License Agreement shall be governed by and interpreted in all respects by the law of the State of California, excluding conflict of law provisions. Nothing in this License Agreement shall be deemed to create any relationship of agency, partnership, or joint venture between BeOpen and Licensee. This License Agreement does not grant permission to use BeOpen trademarks or trade names in a trademark sense to endorse or promote products or services of Licensee, or any third party. As an exception, the "BeOpen Python" logos available at http://www.pythonlabs.com/logos.html may be used according to the permissions granted on that web page.

     7. By copying, installing or otherwise using the software, Licensee agrees to be bound by the terms and conditions of this License Agreement.


CNRI OPEN SOURCE LICENSE AGREEMENT (for Python 1.6b1)

IMPORTANT: PLEASE READ THE FOLLOWING AGREEMENT CAREFULLY.

BY CLICKING ON "ACCEPT" WHERE INDICATED BELOW, OR BY COPYING, INSTALLING OR OTHERWISE USING PYTHON 1.6, beta 1 SOFTWARE, YOU ARE DEEMED TO HAVE AGREED TO THE TERMS AND CONDITIONS OF THIS LICENSE AGREEMENT.

     1. This LICENSE AGREEMENT is between the Corporation for National Research Initiatives, having an office at 1895 Preston White Drive, Reston, VA 20191 ("CNRI"), and the Individual or Organization ("Licensee") accessing and otherwise using Python 1.6, beta 1 software in source or binary form and its associated documentation, as released at the www.python.org Internet site on August 4, 2000 ("Python 1.6b1").

     2. Subject to the terms and conditions of this License Agreement, CNRI hereby grants Licensee a non-exclusive, royalty-free, world-wide license to reproduce, analyze, test, perform and/or display publicly, prepare derivative works, distribute, and otherwise use Python 1.6b1 alone or in any derivative version, provided, however, that CNRIs License Agreement is retained in Python 1.6b1, alone or in any derivative version prepared by Licensee.

     Alternately, in lieu of CNRIs License Agreement, Licensee may substitute the following text (omitting the quotes): "Python 1.6, beta 1, is made available subject to the terms and conditions in CNRIs License Agreement. This Agreement may be located on the Internet using the following unique, persistent identifier (known as a handle): 1895.22/1011. This Agreement may also be obtained from a proxy server on the Internet using the URL:http://hdl.handle.net/1895.22/1011".

     3. In the event Licensee prepares a derivative work that is based on or incorporates Python 1.6b1 or any part thereof, and wants to make the derivative work available to the public as provided herein, then Licensee hereby agrees to indicate in any such work the nature of the modifications made to Python 1.6b1.

     4. CNRI is making Python 1.6b1 available to Licensee on an "AS IS" basis. CNRI MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, CNRI MAKES NO AND DISCLAIMS ANY REPRESENTATION OR WARRANTY OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON 1.6b1 WILL NOT INFRINGE ANY THIRD PARTY RIGHTS.

     5. CNRI SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF THE SOFTWARE FOR ANY INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS A RESULT OF USING, MODIFYING OR DISTRIBUTING PYTHON 1.6b1, OR ANY DERIVATIVE THEREOF, EVEN IF ADVISED OF THE POSSIBILITY THEREOF.

     6. This License Agreement will automatically terminate upon a material breach of its terms and conditions.

     7. This License Agreement shall be governed by and interpreted in all respects by the law of the State of Virginia, excluding conflict of law provisions. Nothing in this License Agreement shall be deemed to create any relationship of agency, partnership, or joint venture between CNRI and Licensee. This License Agreement does not grant permission to use CNRI trademarks or trade name in a trademark sense to endorse or promote products or services of Licensee, or any third party.

     8. By clicking on the "ACCEPT" button where indicated, or by copying, installing or otherwise using Python 1.6b1, Licensee agrees to be bound by the terms and conditions of this License Agreement.

ACCEPT


CWI LICENSE AGREEMENT FOR PYTHON 0.9.0 THROUGH 1.2

Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam, The Netherlands. All rights reserved.

     Permission to use, copy, modify, and distribute this software and its documentation for any purpose and without fee is hereby granted, provided that the above copyright notice appear in all copies and that both that copyright notice and this permission notice appear in supporting documentation, and that the name of Stichting Mathematisch Centrum or CWI not be used in advertising or publicity pertaining to distribution of the software without specific, written prior permission.

     STICHTING MATHEMATISCH CENTRUM DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE, INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS, IN NO EVENT SHALL STICHTING MATHEMATISCH CENTRUM BE LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### EPL-2.0 (elkjs)

```
Eclipse Public License - v 2.0
THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE PUBLIC LICENSE (“AGREEMENT”). ANY USE, REPRODUCTION OR DISTRIBUTION OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

1. DEFINITIONS
“Contribution” means:

a) in the case of the initial Contributor, the initial content Distributed under this Agreement, and
b) in the case of each subsequent Contributor:
i) changes to the Program, and
ii) additions to the Program;
where such changes and/or additions to the Program originate from and are Distributed by that particular Contributor. A Contribution “originates” from a Contributor if it was added to the Program by such Contributor itself or anyone acting on such Contributor's behalf. Contributions do not include changes or additions to the Program that are not Modified Works.
“Contributor” means any person or entity that Distributes the Program.

“Licensed Patents” mean patent claims licensable by a Contributor which are necessarily infringed by the use or sale of its Contribution alone or when combined with the Program.

“Program” means the Contributions Distributed in accordance with this Agreement.

“Recipient” means anyone who receives the Program under this Agreement or any Secondary License (as applicable), including Contributors.

“Derivative Works” shall mean any work, whether in Source Code or other form, that is based on (or derived from) the Program and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship.

“Modified Works” shall mean any work in Source Code or other form that results from an addition to, deletion from, or modification of the contents of the Program, including, for purposes of clarity any new file in Source Code form that contains any contents of the Program. Modified Works shall not include works that contain only declarations, interfaces, types, classes, structures, or files of the Program solely in each case in order to link to, bind by name, or subclass the Program or Modified Works thereof.

“Distribute” means the acts of a) distributing or b) making available in any manner that enables the transfer of a copy.

“Source Code” means the form of a Program preferred for making modifications, including but not limited to software source code, documentation source, and configuration files.

“Secondary License” means either the GNU General Public License, Version 2.0, or any later versions of that license, including any exceptions or additional permissions as identified by the initial Contributor.

2. GRANT OF RIGHTS
a) Subject to the terms of this Agreement, each Contributor hereby grants Recipient a non-exclusive, worldwide, royalty-free copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, Distribute and sublicense the Contribution of such Contributor, if any, and such Derivative Works.
b) Subject to the terms of this Agreement, each Contributor hereby grants Recipient a non-exclusive, worldwide, royalty-free patent license under Licensed Patents to make, use, sell, offer to sell, import and otherwise transfer the Contribution of such Contributor, if any, in Source Code or other form. This patent license shall apply to the combination of the Contribution and the Program if, at the time the Contribution is added by the Contributor, such addition of the Contribution causes such combination to be covered by the Licensed Patents. The patent license shall not apply to any other combinations which include the Contribution. No hardware per se is licensed hereunder.
c) Recipient understands that although each Contributor grants the licenses to its Contributions set forth herein, no assurances are provided by any Contributor that the Program does not infringe the patent or other intellectual property rights of any other entity. Each Contributor disclaims any liability to Recipient for claims brought by any other entity based on infringement of intellectual property rights or otherwise. As a condition to exercising the rights and licenses granted hereunder, each Recipient hereby assumes sole responsibility to secure any other intellectual property rights needed, if any. For example, if a third party patent license is required to allow Recipient to Distribute the Program, it is Recipient's responsibility to acquire that license before distributing the Program.
d) Each Contributor represents that to its knowledge it has sufficient copyright rights in its Contribution, if any, to grant the copyright license set forth in this Agreement.
e) Notwithstanding the terms of any Secondary License, no Contributor makes additional grants to any Recipient (other than those set forth in this Agreement) as a result of such Recipient's receipt of the Program under the terms of a Secondary License (if permitted under the terms of Section 3).
3. REQUIREMENTS
3.1 If a Contributor Distributes the Program in any form, then:

a) the Program must also be made available as Source Code, in accordance with section 3.2, and the Contributor must accompany the Program with a statement that the Source Code for the Program is available under this Agreement, and informs Recipients how to obtain it in a reasonable manner on or through a medium customarily used for software exchange; and
b) the Contributor may Distribute the Program under a license different than this Agreement, provided that such license:
i) effectively disclaims on behalf of all other Contributors all warranties and conditions, express and implied, including warranties or conditions of title and non-infringement, and implied warranties or conditions of merchantability and fitness for a particular purpose;
ii) effectively excludes on behalf of all other Contributors all liability for damages, including direct, indirect, special, incidental and consequential damages, such as lost profits;
iii) does not attempt to limit or alter the recipients' rights in the Source Code under section 3.2; and
iv) requires any subsequent distribution of the Program by any party to be under a license that satisfies the requirements of this section 3.
3.2 When the Program is Distributed as Source Code:

a) it must be made available under this Agreement, or if the Program (i) is combined with other material in a separate file or files made available under a Secondary License, and (ii) the initial Contributor attached to the Source Code the notice described in Exhibit A of this Agreement, then the Program may be made available under the terms of such Secondary Licenses, and
b) a copy of this Agreement must be included with each copy of the Program.
3.3 Contributors may not remove or alter any copyright, patent, trademark, attribution notices, disclaimers of warranty, or limitations of liability (‘notices’) contained within the Program from any copy of the Program which they Distribute, provided that Contributors may add their own appropriate notices.

4. COMMERCIAL DISTRIBUTION
Commercial distributors of software may accept certain responsibilities with respect to end users, business partners and the like. While this license is intended to facilitate the commercial use of the Program, the Contributor who includes the Program in a commercial product offering should do so in a manner which does not create potential liability for other Contributors. Therefore, if a Contributor includes the Program in a commercial product offering, such Contributor (“Commercial Contributor”) hereby agrees to defend and indemnify every other Contributor (“Indemnified Contributor”) against any losses, damages and costs (collectively “Losses”) arising from claims, lawsuits and other legal actions brought by a third party against the Indemnified Contributor to the extent caused by the acts or omissions of such Commercial Contributor in connection with its distribution of the Program in a commercial product offering. The obligations in this section do not apply to any claims or Losses relating to any actual or alleged intellectual property infringement. In order to qualify, an Indemnified Contributor must: a) promptly notify the Commercial Contributor in writing of such claim, and b) allow the Commercial Contributor to control, and cooperate with the Commercial Contributor in, the defense and any related settlement negotiations. The Indemnified Contributor may participate in any such claim at its own expense.

For example, a Contributor might include the Program in a commercial product offering, Product X. That Contributor is then a Commercial Contributor. If that Commercial Contributor then makes performance claims, or offers warranties related to Product X, those performance claims and warranties are such Commercial Contributor's responsibility alone. Under this section, the Commercial Contributor would have to defend claims against the other Contributors related to those performance claims and warranties, and if a court requires any other Contributor to pay any damages as a result, the Commercial Contributor must pay those damages.

5. NO WARRANTY
EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT PERMITTED BY APPLICABLE LAW, THE PROGRAM IS PROVIDED ON AN “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Each Recipient is solely responsible for determining the appropriateness of using and distributing the Program and assumes all risks associated with its exercise of rights under this Agreement, including but not limited to the risks and costs of program errors, compliance with applicable laws, damage to or loss of data, programs or equipment, and unavailability or interruption of operations.

6. DISCLAIMER OF LIABILITY
EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, AND TO THE EXTENT PERMITTED BY APPLICABLE LAW, NEITHER RECIPIENT NOR ANY CONTRIBUTORS SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM OR THE EXERCISE OF ANY RIGHTS GRANTED HEREUNDER, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

7. GENERAL
If any provision of this Agreement is invalid or unenforceable under applicable law, it shall not affect the validity or enforceability of the remainder of the terms of this Agreement, and without further action by the parties hereto, such provision shall be reformed to the minimum extent necessary to make such provision valid and enforceable.

If Recipient institutes patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Program itself (excluding combinations of the Program with other software or hardware) infringes such Recipient's patent(s), then such Recipient's rights granted under Section 2(b) shall terminate as of the date such litigation is filed.

All Recipient's rights under this Agreement shall terminate if it fails to comply with any of the material terms or conditions of this Agreement and does not cure such failure in a reasonable period of time after becoming aware of such noncompliance. If all Recipient's rights under this Agreement terminate, Recipient agrees to cease use and distribution of the Program as soon as reasonably practicable. However, Recipient's obligations under this Agreement and any licenses granted by Recipient relating to the Program shall continue and survive.

Everyone is permitted to copy and distribute copies of this Agreement, but in order to avoid inconsistency the Agreement is copyrighted and may only be modified in the following manner. The Agreement Steward reserves the right to publish new versions (including revisions) of this Agreement from time to time. No one other than the Agreement Steward has the right to modify this Agreement. The Eclipse Foundation is the initial Agreement Steward. The Eclipse Foundation may assign the responsibility to serve as the Agreement Steward to a suitable separate entity. Each new version of the Agreement will be given a distinguishing version number. The Program (including Contributions) may always be Distributed subject to the version of the Agreement under which it was received. In addition, after a new version of the Agreement is published, Contributor may elect to Distribute the Program (including its Contributions) under the new version.

Except as expressly stated in Sections 2(a) and 2(b) above, Recipient receives no rights or licenses to the intellectual property of any Contributor under this Agreement, whether expressly, by implication, estoppel or otherwise. All rights in the Program not expressly granted under this Agreement are reserved. Nothing in this Agreement is intended to be enforceable by any entity that is not a Contributor or Recipient. No third-party beneficiary rights are created under this Agreement.

Exhibit A – Form of Secondary Licenses Notice
“This Source Code may also be made available under the following Secondary Licenses when the conditions for such availability set forth in the Eclipse Public License, v. 2.0 are satisfied: {name license(s), version(s), and exceptions or additional permissions here}.”

Simply including a copy of this Agreement, including this Exhibit A is not sufficient to license the Source Code under Secondary Licenses.

If it is not possible or desirable to put the notice in a particular file, then You may include the notice in a location (such as a LICENSE file in a relevant directory) where a recipient would be likely to look for such a notice.

You may add additional accurate notices of copyright ownership.
```
