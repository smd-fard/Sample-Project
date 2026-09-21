import "reflect-metadata";

import { Application } from "express";
import { Container } from "typedi";

import { createApp } from "../../src/index";
import { InMemoryRealtimeSessionRepository } from '../../src/repositories/InMemoryRealtimeSessionRepository';

/**
 * Base class for functional (HTTP-level) tests. Boots the real configured app
 * via `createApp()` and exposes it as `this.app` for Supertest.
 *
 * The in-memory repositories are typedi singletons, so their state leaks across
 * suites unless cleared. When you add a repository, clear its store in
 * `resetStores()` (e.g. `Container.get(InMemoryItemRepository).clear()`).
 *
 * Subclass per endpoint, add named `test*` methods, and bridge them through
 * `describe`/`test` at the bottom of the file.
 */
export abstract class BaseFunctionalTest {
  protected app!: Application;

  public async setup(): Promise<void> {
    this.app = createApp();
    this.resetStores();
  }

  public async teardown(): Promise<void> {
    this.resetStores();
  }

  /** Clear every in-memory repository so suites don't leak state into each other. */
  protected resetStores(): void {
    Container.get(InMemoryRealtimeSessionRepository).clear();
  }
}
