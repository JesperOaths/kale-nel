"""Treat a disconnected HTTP client as request cancellation, not a server fault."""


def install(handler_class):
    if '_quiet_disconnect_v1' in handler_class.__dict__:
        return
    original = handler_class.handle

    def handle(self):
        try:
            return original(self)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    handler_class.handle = handle
    handler_class._quiet_disconnect_v1 = True
