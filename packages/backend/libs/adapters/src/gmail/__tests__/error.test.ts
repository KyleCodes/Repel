import { describe, expect, test } from 'bun:test';
import { AppError } from '@repel/errors';
import { AdapterError } from '../../error.ts';
import { GmailNotImplementedError } from '../error.ts';

describe('GmailNotImplementedError', function () {
  test('extends AdapterError and AppError', function () {
    const err = new GmailNotImplementedError('not yet');
    expect(err).toBeInstanceOf(GmailNotImplementedError);
    expect(err).toBeInstanceOf(AdapterError);
    expect(err).toBeInstanceOf(AppError);
  });

  test('sets name to the concrete class', function () {
    const err = new GmailNotImplementedError('not yet');
    expect(err.name).toBe('GmailNotImplementedError');
  });
});
