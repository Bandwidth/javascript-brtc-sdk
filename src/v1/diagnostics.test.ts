import { DiagnosticsBatcher } from "./diagnostics";
import logger from "../logging";

// Mock logger to avoid side effects
jest.mock("../logging", () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    removeListener: jest.fn(),
  },
}));

describe("DiagnosticsBatcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("should create instance without error", () => {
    const diagnostics = new DiagnosticsBatcher();
    expect(diagnostics).toBeDefined();
    expect(diagnostics).toBeInstanceOf(DiagnosticsBatcher);
  });

  test("should set up logger listener in constructor", () => {
    new DiagnosticsBatcher();
    expect(logger.on).toHaveBeenCalledWith("log", expect.any(Function));
  });

  test("should set up flush interval in constructor", () => {
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const flushInterval = 5000;
    new DiagnosticsBatcher(flushInterval);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), flushInterval);
    setIntervalSpy.mockRestore();
  });

  test("should emit diagnostics when flushing", () => {
    const diagnostics = new DiagnosticsBatcher();
    const mockCallback = jest.fn();

    diagnostics.on("diagnostics", mockCallback);
    diagnostics.flushDiagnostics();

    expect(mockCallback).toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith({ logs: expect.any(Array) });
  });

  test("should clear log events after flushing", () => {
    const diagnostics = new DiagnosticsBatcher();
    const mockCallback = jest.fn();

    // Access private property to add some logs
    (diagnostics as any).logEvents = [{ level: "info", message: "test" }];

    diagnostics.on("diagnostics", mockCallback);
    diagnostics.flushDiagnostics();

    // First flush should have logs
    expect(mockCallback).toHaveBeenCalledWith({ logs: [{ level: "info", message: "test" }] });

    // Second flush should have empty logs
    diagnostics.flushDiagnostics();
    expect(mockCallback).toHaveBeenLastCalledWith({ logs: [] });
  });

  test("should return diagnostics from getDiagnostics", () => {
    const diagnostics = new DiagnosticsBatcher();

    const result = diagnostics.getDiagnostics();
    expect(result).toEqual({ logs: [] });
  });

  test("should flush diagnostics and clear interval on shutdown", () => {
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    const diagnostics = new DiagnosticsBatcher();
    const mockCallback = jest.fn();

    diagnostics.on("diagnostics", mockCallback);
    diagnostics.shutdown();

    expect(mockCallback).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(logger.removeListener).toHaveBeenCalledWith("log", expect.any(Function));
    clearIntervalSpy.mockRestore();
  });
});
