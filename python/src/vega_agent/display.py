from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .chart import Chart


class Displayable:
    def chart(self) -> Chart:
        from .chart import chart

        return chart(self)

    def _repr_mimebundle_(self, **kwargs):
        bundle = self.chart()._repr_mimebundle_(**kwargs)
        data, metadata = bundle if isinstance(bundle, tuple) else (bundle, {})
        return {**(data or {}), "text/plain": repr(self)}, metadata
