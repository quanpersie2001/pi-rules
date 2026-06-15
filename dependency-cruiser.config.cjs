/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "shared-no-upper-layers",
			comment: "shared/ must not depend on domain, features, app, or pi",
			severity: "error",
			from: { path: "^extension-src/pi-rules/shared/" },
			to: {
				path: "^(extension-src/pi-rules/domain/|extension-src/pi-rules/features/|extension-src/pi-rules/app/|extension-src/pi-rules/pi/)",
			},
		},
		{
			name: "domain-no-upper-layers",
			comment: "domain/ must not depend on features, app, or pi",
			severity: "error",
			from: { path: "^extension-src/pi-rules/domain/" },
			to: {
				path: "^(extension-src/pi-rules/features/|extension-src/pi-rules/app/|extension-src/pi-rules/pi/)",
			},
		},
		{
			name: "features-no-upper-layers",
			comment: "features/ must not depend on app or pi",
			severity: "error",
			from: { path: "^extension-src/pi-rules/features/" },
			to: {
				path: "^(extension-src/pi-rules/app/|extension-src/pi-rules/pi/)",
			},
		},
		{
			name: "app-no-pi",
			comment: "app/ must not depend on pi/",
			severity: "error",
			from: { path: "^extension-src/pi-rules/app/" },
			to: { path: "^extension-src/pi-rules/pi/" },
		},
		{
			name: "no-cross-layer-skips",
			comment: "Only pi/ may skip layers (pi -> any). All other layers must follow the strict chain.",
			severity: "error",
			from: {
				path: "^(extension-src/pi-rules/shared/|extension-src/pi-rules/domain/|extension-src/pi-rules/features/|extension-src/pi-rules/app/)",
			},
			to: { path: "^extension-src/pi-rules/pi/" },
		},
	],
	options: {
		doNotFollow: {
			path: "node_modules",
		},
		tsPreCompilationDeps: true,
		tsConfig: {
			fileName: "tsconfig.json",
		},
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "require", "default"],
		},
		reporterOptions: {
			text: {
				highlightFocused: true,
			},
		},
	},
};
