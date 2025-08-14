import os
import sys
import types
import inspect
import asyncio

# Ensure project root is on sys.path for module imports like `modal_apps.*`
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

"""Install lightweight stubs for external deps so unit tests never hit prod or require packages.

These stubs satisfy imports used by `modal_apps.workflow_executor` during module import and unit tests.
They are minimal and safe; real integration tests should use actual packages.
"""

# Stub `modal`
if 'modal' not in sys.modules:
    modal = types.ModuleType('modal')

    class _App:
        def __init__(self, *_args, **_kwargs):
            pass

        def function(self, *decorator_args, **decorator_kwargs):  # noqa: ARG002
            def _decorator(fn):
                # Attach a `.local` method that simply calls the function
                def _local(**kwargs):
                    return fn(**kwargs)
                setattr(fn, "local", _local)
                return fn
            return _decorator

    class _Secret:
        @staticmethod
        def from_name(_name):
            return object()

    class _Image:
        @staticmethod
        def debian_slim():
            return _Image()

        def pip_install(self, _packages):
            return self

        def env(self, *_args, **_kwargs):
            return self

        def add_local_python_source(self, *_args, **_kwargs):
            return self

    modal.App = _App
    modal.Secret = _Secret
    modal.Image = _Image
    class _Period:
        def __init__(self, seconds=0, minutes=0, hours=0):  # noqa: ARG002
            pass
    modal.Period = _Period
    sys.modules['modal'] = modal

# Stub `psycopg2` and `psycopg2.extras.RealDictCursor`
if 'psycopg2' not in sys.modules:
    psycopg2 = types.ModuleType('psycopg2')

    class _Cursor:
        def execute(self, *_a, **_k):
            pass
        def fetchone(self):
            return None
        def fetchall(self):
            return []
        def close(self):
            pass

    class _Conn:
        def __init__(self, *_a, **_k):
            self.autocommit = False
        def cursor(self, cursor_factory=None):  # noqa: ARG002
            return _Cursor()
        def commit(self):
            pass
        def close(self):
            pass

    def _connect(**_kwargs):
        return _Conn()

    psycopg2.connect = _connect
    sys.modules['psycopg2'] = psycopg2

if 'psycopg2.extras' not in sys.modules:
    extras = types.ModuleType('psycopg2.extras')
    class RealDictCursor:  # noqa: N801 - match name
        pass
    extras.RealDictCursor = RealDictCursor
    sys.modules['psycopg2.extras'] = extras

# Stub `httpx` for functions that import it inside call-sites
if 'httpx' not in sys.modules:
    httpx = types.ModuleType('httpx')
    class AsyncClient:
        def __init__(self, *_, **__):
            self._closed = False
        async def post(self, *_args, **_kwargs):
            class _Resp:
                status_code = 200
                text = ''
                headers = {}
            return _Resp()
        async def get(self, *_args, **_kwargs):
            class _Resp:
                status_code = 200
                text = ''
                headers = {}
            return _Resp()
        async def aclose(self):
            self._closed = True
    httpx.AsyncClient = AsyncClient
    sys.modules['httpx'] = httpx


# Minimal async support without external plugins
def pytest_pyfunc_call(pyfuncitem):  # type: ignore[override]
    testfunction = pyfuncitem.obj
    if inspect.iscoroutinefunction(testfunction):
        asyncio.run(testfunction(**pyfuncitem.funcargs))
        return True
    return None


