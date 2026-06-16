const parseEnvString = (envKey: string): string => {
	if(process.env[envKey] === undefined) {
		throw new Error(`Environment variable ${envKey} is not set.`);
	}
	return process.env[envKey] as string;
};

const parseEnvBoolean = (envKey: string): boolean => {
	if(process.env[envKey] === undefined) {
		throw new Error(`Environment variable ${envKey} is not set`);
	}
	return process.env[envKey] === 'true';
};

const parseEnvNumber = (envKey: string): number => {
	if(process.env[envKey] === undefined) {
		throw new Error(`Environment variable ${envKey} is not set`);
	}
	return Number(process.env[envKey]);
};

export { parseEnvString, parseEnvBoolean, parseEnvNumber };

