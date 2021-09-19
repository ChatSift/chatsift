/**
 * Credits to https://github.com/Naval-Base/ms
 */

const enum Duration {
  second = 1000,
  minute = second * 60,
  hour = minute * 60,
  day = hour * 24,
  week = day * 7,
  year = day * 365.25
}

const seperators = [' ', '.', ',', '-'];
const regex = /^(-?(?:\d+)?\.?\d+) *([a-z]+)?$/;

function tokenize(str: string) {
  const units = [];
  let buf = '';
  let letter = false;

  for (const char of str) {
    if (seperators.includes(char)) {
      buf += char;
    } else if (isNaN(parseInt(char, 10))) {
      buf += char;
      letter = true;
    } else {
      if (letter) {
        units.push(buf.trim());
        buf = '';
      }
      letter = false;
      buf += char;
    }
  }

  if (buf.length) {
    units.push(buf.trim());
  }

  return units;
}

function convert(num: number, type: string) {
  /* istanbul ignore next */
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y': {
      return num * Duration.year;
    }
    case 'weeks':
    case 'week':
    case 'w': {
      return num * Duration.week;
    }
    case 'days':
    case 'day':
    case 'd': {
      return num * Duration.day;
    }
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h': {
      return num * Duration.hour;
    }
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm': {
      return num * Duration.minute;
    }
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's': {
      return num * Duration.second;
    }
  }
  return num;
}

function pluralize(ms: number, msAbs: number, n: number, long: string, short: string, l = false) {
  const plural = msAbs >= n * 1.5;
  return `${Math.round(ms / n)}${l ? ` ${long}${plural ? 's' : ''}` : short}`;
}

function ms(val: string, long?: boolean): number;
function ms(val: number, long?: boolean): string;
function ms(val: string | number, long = false) {
  let abs;
  let ms = 0;
  if (typeof val === 'string' && val.length) {
    if (val.length < 101) {
      const units = tokenize(val.toLowerCase());
      for (const unit of units) {
        const fmt = regex.exec(unit);
        if (fmt) {
          abs = parseFloat(fmt[1]!);
          ms += convert(abs, fmt[2]!);
        }
      }
      return ms;
    }
  }

  if (typeof val === 'number' && isFinite(val)) {
    abs = Math.abs(val);

    /* istanbul ignore next */
    if (abs >= Duration.day) {
      return pluralize(val, abs, Duration.day, 'day', 'd', long);
    }

    /* istanbul ignore next */
    if (abs >= Duration.hour) {
      return pluralize(val, abs, Duration.hour, 'hour', 'h', long);
    }

    /* istanbul ignore next */
    if (abs >= Duration.minute) {
      return pluralize(val, abs, Duration.minute, 'minute', 'm', long);
    }

    /* istanbul ignore next */
    if (abs >= Duration.second) {
      return pluralize(val, abs, Duration.second, 'second', 's', long);
    }

    return `${val}${long ? ' ' : ''}ms`;
  }

  throw new TypeError(`Value is an empty string or an invalid number. Value=${JSON.stringify(val)}`);
}

export { ms };
export default ms;
